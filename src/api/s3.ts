import type { ApiConfig } from "../config";


export async function uploadtoS3(cfg: ApiConfig, key: string, processedFilePath: string, contentType: string) {
    const s3File = cfg.s3Client.file(`${key}`);
    const videoFile = Bun.file(processedFilePath);
    await s3File.write(videoFile, {
        type: contentType,
    });
}