import https from 'https';

interface PushMessage {
  to: string;
  sound?: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
  badge?: number;
  _displayInForeground?: boolean;
}

/**
 * Sends push notification via Expo Push Notification API
 */
export const sendPushNotification = async (
  toToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, any>
): Promise<boolean> => {
  if (!toToken || !toToken.trim()) {
    console.log('[PushNotification] No push token provided for user.');
    return false;
  }

  const token = toToken.trim();

  // Basic check for Expo Push Token format: ExponentPushToken[...] or ExpoPushToken[...]
  if (!token.startsWith('ExponentPushToken[') && !token.startsWith('ExpoPushToken[')) {
    console.warn('[PushNotification] Invalid Expo Push Token format:', token);
    return false;
  }

  const payload: PushMessage = {
    to: token,
    sound: 'default',
    title,
    body,
    priority: 'high',
    channelId: 'default',
    badge: 1,
    _displayInForeground: true,
    data: data || {},
  };

  try {
    const postData = JSON.stringify(payload);
    
    const options = {
      hostname: 'exp.host',
      path: '/--/api/v2/push/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    return new Promise<boolean>((resolve) => {
      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseData);
            console.log('[PushNotification] Expo notification response:', parsed);
            resolve(true);
          } catch (e) {
            console.log('[PushNotification] Raw response:', responseData);
            resolve(true);
          }
        });
      });

      req.on('error', (err) => {
        console.error('[PushNotification] Network error sending notification:', err);
        resolve(false);
      });

      req.write(postData);
      req.end();
    });
  } catch (error) {
    console.error('[PushNotification] Exception while sending notification:', error);
    return false;
  }
};

/**
 * Broadcasts push notifications to multiple push tokens
 */
export const sendPushNotificationToMultiple = async (
  tokens: (string | null | undefined)[],
  title: string,
  body: string,
  data?: Record<string, any>
): Promise<void> => {
  const validTokens = Array.from(
    new Set(
      tokens
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim())
    )
  );

  for (const token of validTokens) {
    await sendPushNotification(token, title, body, data);
  }
};
