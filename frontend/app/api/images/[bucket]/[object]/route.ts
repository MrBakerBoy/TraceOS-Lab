import { NextRequest, NextResponse } from "next/server";
import { Client } from "minio";

const minioClient = new Client({
  endPoint: "minio",
  port: 9000,
  useSSL: false,
  accessKey: "traceos",
  secretKey: "traceos_dev",
});

export async function GET(
  req: NextRequest,
  { params }: { params: { bucket: string; object: string } }
) {
  try {
    const { bucket, object } = params;
    const stream = await minioClient.getObject(bucket, object);
    
    // Get object stat for content-type
    const stat = await minioClient.statObject(bucket, object);
    
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": stat.metaData?.["content-type"] || "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return new NextResponse("Not found", { status: 404 });
  }
}
