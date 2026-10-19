// utils/storage.js
// Where delivered project files are kept.
//
// • Cloudflare R2 (when the R2_* variables are set): files survive redeploys,
//   because they live outside the server. Downloads go straight from R2 through
//   a short-lived signed link, so large files don't pass through the server.
// • Local disk (otherwise): fine for local development, but Railway wipes the
//   disk on every redeploy.
//
// Each file record remembers which one it was saved to, so files delivered
// before switching to R2 can still be downloaded while they exist.

const fs = require('fs');
const path = require('path');

const LOCAL_ROOT = path.join(__dirname, '..', 'uploads', 'deliveries');
const DOWNLOAD_LINK_SECONDS = 5 * 60;

function r2Configured() {
  return Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID
    && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
}

let client = null;
function r2Client() {
  if (!client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT.trim().replace(/\/+$/, ''),
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(),
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim(),
      },
    });
  }
  return client;
}

const objectKey = (requestId, filename) => `deliveries/${requestId}/${filename}`;
const localPath = (requestId, filename) => path.join(LOCAL_ROOT, String(requestId), filename);

// Takes a file multer has just written to local disk and stores it for good.
// Returns the storage backend used, to be saved on the file record.
async function saveDeliveredFile(requestId, file) {
  if (!r2Configured()) return 'disk';

  const { Upload } = require('@aws-sdk/lib-storage');
  const upload = new Upload({
    client: r2Client(),
    params: {
      Bucket: process.env.R2_BUCKET.trim(),
      Key: objectKey(requestId, file.filename),
      Body: fs.createReadStream(file.path),
      ContentType: file.mimetype || 'application/octet-stream',
    },
  });
  await upload.done();
  await fs.promises.unlink(file.path).catch(() => {}); // the local copy is no longer needed
  return 'r2';
}

// A signed R2 link that downloads the file under its original name.
async function getDownloadUrl(requestId, fileRecord) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const safeName = fileRecord.originalName.replace(/["\\\r\n]/g, '_');
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET.trim(),
    Key: objectKey(requestId, fileRecord.filename),
    ResponseContentDisposition: `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(fileRecord.originalName)}`,
  });
  return getSignedUrl(r2Client(), command, { expiresIn: DOWNLOAD_LINK_SECONDS });
}

module.exports = { r2Configured, saveDeliveredFile, getDownloadUrl, localPath, LOCAL_ROOT };
