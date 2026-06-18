/**
 * Gmail API Service
 * Wrapper around Google Gmail API with rate limiting and error handling
 */

const { google } = require('googleapis');
const logger = require('../utils/logger');
const db = require('../utils/db');

class GmailService {
  constructor() {
    this.gmail = null;
    this.rateLimitTracker = {};
  }

  /**
   * Initialize Gmail client for a user
   * @param {string} userId - User ID
   * @param {string} refreshToken - Gmail refresh token
   */
  async initializeForUser(userId, refreshToken) {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI
      );

      oauth2Client.setCredentials({ refresh_token: refreshToken });
      this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      
      logger.info(`Gmail client initialized for user ${userId}`);
    } catch (err) {
      logger.error(`Failed to initialize Gmail for user ${userId}:`, err);
      throw err;
    }
  }

  /**
   * Check if rate limited and wait if necessary
   * @param {string} userId - User ID
   */
  async checkRateLimit(userId) {
    const rateLimit = parseInt(process.env.GMAIL_RATE_LIMIT_PER_MINUTE || 60);
    const windowMs = 60 * 1000; // 1 minute window

    if (!this.rateLimitTracker[userId]) {
      this.rateLimitTracker[userId] = { count: 0, resetTime: Date.now() + windowMs };
    }

    const tracker = this.rateLimitTracker[userId];

    // Reset counter if window expired
    if (Date.now() > tracker.resetTime) {
      tracker.count = 0;
      tracker.resetTime = Date.now() + windowMs;
    }

    // Check if over limit
    if (tracker.count >= rateLimit) {
      const waitTime = tracker.resetTime - Date.now();
      logger.warn(`Rate limit reached for user ${userId}. Waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      tracker.count = 0;
      tracker.resetTime = Date.now() + windowMs;
    }

    tracker.count++;
  }

  /**
   * Get user's email profile
   * @returns {object} Profile information
   */
  async getProfile() {
    try {
      const profile = await this.gmail.users.getProfile({ userId: 'me' });
      return profile.data;
    } catch (err) {
      logger.error('Failed to get Gmail profile:', err);
      throw err;
    }
  }

  /**
   * List messages with pagination
   * @param {object} options - Query options
   * @param {string} options.q - Query string (e.g., "is:unread")
   * @param {number} options.maxResults - Max results per page
   * @param {string} options.pageToken - Pagination token
   * @returns {object} { messages: [...], nextPageToken: string }
   */
  async listMessages(options = {}) {
    try {
      const {
        q = '',
        maxResults = 100,
        pageToken = null,
      } = options;

      const params = {
        userId: 'me',
        maxResults,
        q,
      };

      if (pageToken) {
        params.pageToken = pageToken;
      }

      const result = await this.gmail.users.messages.list(params);
      
      return {
        messages: result.data.messages || [],
        nextPageToken: result.data.nextPageToken,
      };
    } catch (err) {
      logger.error('Failed to list messages:', err);
      throw err;
    }
  }

  /**
   * Get full message details
   * @param {string} messageId - Gmail message ID
   * @returns {object} Full message object
   */
  async getMessage(messageId) {
    try {
      const message = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      return message.data;
    } catch (err) {
      logger.error(`Failed to get message ${messageId}:`, err);
      throw err;
    }
  }

  /**
   * Batch get multiple messages
   * @param {array} messageIds - Array of message IDs
   * @returns {array} Array of full messages
   */
  async batchGetMessages(messageIds) {
    try {
      const batchRequests = messageIds.map(id => ({
        id: Math.random().toString(),
        method: 'GET',
        uri: `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      }));

      // Gmail batch API can handle up to 100 requests
      const results = [];
      for (let i = 0; i < batchRequests.length; i += 100) {
        const batch = batchRequests.slice(i, i + 100);
        const response = await this.gmail.users.messages.batchGet({
          userId: 'me',
          requestBody: { ids: messageIds.slice(i, i + 100) },
        });
        results.push(...(response.data.messages || []));
      }

      return results;
    } catch (err) {
      logger.error('Failed to batch get messages:', err);
      throw err;
    }
  }

  /**
   * Send an email
   * @param {object} email - Email object { to, subject, body }
   * @param {string} threadId - Optional thread ID for replies
   * @returns {object} Sent message
   */
  async sendMessage(email, threadId = null) {
    try {
      const { to, subject, body } = email;

      // Build email message
      let message = `To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`;

      // For replies, add thread headers
      if (threadId) {
        // TODO: Get in-reply-to and references from original thread
        message = `In-Reply-To: <${threadId}>\r\n` + message;
      }

      // Base64 encode
      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const result = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
          threadId: threadId || undefined,
        },
      });

      logger.info(`Message sent to ${to}`);
      return result.data;
    } catch (err) {
      logger.error('Failed to send message:', err);
      throw err;
    }
  }

  /**
   * Get all labels
   * @returns {array} Array of label objects
   */
  async getLabels() {
    try {
      const result = await this.gmail.users.labels.list({ userId: 'me' });
      return result.data.labels || [];
    } catch (err) {
      logger.error('Failed to get labels:', err);
      throw err;
    }
  }
}

module.exports = new GmailService();
