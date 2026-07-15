import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';

admin.initializeApp();

export const uploadMediaToDrive = functions.https.onCall(async (data: { fileName: string; base64Data: string; mimeType: string }, context: functions.https.CallableContext) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const { fileName, base64Data, mimeType } = data;
  if (!fileName || !base64Data || !mimeType) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing file name, data, or mime type.');
  }

  try {
    const buffer = Buffer.from(base64Data, 'base64');

    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata = {
      name: fileName,
    };
    const media = {
      mimeType: mimeType,
      body: require('stream').Readable.from(buffer),
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
    });

    return {
      success: true,
      fileId: response.data.id,
      link: response.data.webViewLink,
    };
  } catch (error: any) {
    throw new functions.https.HttpsError('internal', error.message || 'Drive upload failed.');
  }
});
