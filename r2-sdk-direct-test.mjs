import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const client = new S3Client({
  region: "auto",
  endpoint: "https://82c5626c0a9593d891e8c51a42370d07.r2.cloudflarestorage.com",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

try {
  await client.send(
    new PutObjectCommand({
      Bucket: "vedh-medical-imaging-dataset",
      Key: "sdk-direct-test.txt",
      Body: "SDK direct test",
    }),
  );

  console.log("SDK DIRECT UPLOAD OK");
} catch (e) {
  console.error("SDK DIRECT UPLOAD FAILED");
  console.error("name:", e.name);
  console.error("message:", e.message);
  console.error("status:", e.$metadata?.httpStatusCode);
  console.error("requestId:", e.$metadata?.requestId);
  console.error(e.stack);
  process.exit(1);
}
