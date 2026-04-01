module.exports = {
  async notify({ userId, title, body }) {
    return {
      integrationNeeded: true,
      provider: process.env.PUSH_PROVIDER || 'custom',
      userId,
      title,
      body,
      message: 'Connect Firebase Cloud Messaging, OneSignal, or your preferred push provider here.'
    };
  }
};
