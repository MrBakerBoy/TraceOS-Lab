import { NextRequest, NextResponse } from "next/server";
import { Client } from "minio";

const minioClient = new Client({
  endPoint: "minio",
  port: 9000,
  useSSL: false,
  accessKey: "traceos",
  secretKey: "traceos_dev",
});

const BUCKET = "experiment-images";
const MAX_SIZE = 10 * 1024 * 1024;

async function ensureBucket() {
  const exists = await minioClient.bucketExists(BUCKET);
  if (!exists) {
    await minioClient.makeBucket(BUCKET, "us-east-1");
    const policy = {
      Version: "2012-10-17",
      Statement: [{
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${BUCKET}/*`],
      }],
    };
    await minioClient.setBucketPolicy(BUCKET, JSON.stringify(policy));
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureBucket();
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "Too large (max 10MB)" }, { status: 400 });

    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
    if (!allowed.includes(file.type)) return NextResponse.json({ error: "Unsupported type" }, { status: 400 });

    const ext = file.name.split(".").pop() || "png";
    const objectName = `${crypto.randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    await minioClient.putObject(BUCKET, objectName, buffer, file.size, {
      "Content-Type": file.type,
    });

    const url = `/api/images/${BUCKET}/${objectName}`;
    return NextResponse.json({ url, objectName });
  } catch (err: any) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
