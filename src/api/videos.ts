import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import { s3, S3Client, type BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { BadRequestError, UserForbiddenError } from "./errors";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  
  const { videoId } = req.params as { videoId?: string }
  if (!videoId) {
    throw new BadRequestError("Invalid video Id");
  }

  const token = getBearerToken(req.headers);
  const userId = validateJWT(token, cfg.jwtSecret);

  const videoMeta = getVideo(cfg.db, videoId);
  if (videoMeta?.userID !== userId) {
    throw new UserForbiddenError("Unauthorized user");
  }

  const formData = await req.formData();
  const videoFile = formData.get("video");
  
  if (!(videoFile instanceof File)) {
    throw new BadRequestError("Video file is missing");
  }

  const MAX_UPLOAD_SIZE = 1 << 30;
  if (videoFile.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File size exceeds the maximum file size 1GB");
  }

  if (videoFile.type !== "video/mp4") {
    throw new BadRequestError("Unsupported file type. Only MP4 allowed");
  }

  await Bun.write("./temp/temp.mp4", videoFile);

  const client = cfg.s3Client;
  const s3File = client.file(`${videoId}.mp4`);

  await s3File.write(Bun.file("./temp/temp.mp4"), {
    type: "video/mp4",
  });

  await Bun.file("./temp/temp.mp4").delete();
  
  let url  = `https://${cfg.s3Bucket}.s3.eu-north-1.amazonaws.com/${videoId}.mp4`;

  videoMeta.videoURL = url;
  updateVideo(cfg.db, videoMeta);

  return respondWithJSON(200, null);
}
