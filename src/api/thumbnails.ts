import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import { type BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getAssetDiskPath, getAssetPath, getAssetURL, getFileExtension } from "./assets";

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const videoMeta = getVideo(cfg.db, videoId);
  if (videoMeta?.userID !== userID) {
    throw new UserForbiddenError("Unauthorized user");
  }

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData()
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file is missing");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File size exceeds the maximum size 10MB");
  }

  const mediaType = file.type;
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for thumbnail");
  }


  const allowedFileTypes = ["image/png", "image/jpeg"];
  if (!allowedFileTypes.includes(mediaType)) {
    throw new BadRequestError("Unsupported file type. Only JPEG or PNG allowed.")
  }

  

  const assetPath = getAssetPath(mediaType);

  const assetDiskPath = getAssetDiskPath(cfg, assetPath);
  await Bun.write(assetDiskPath, file);
  
  const thumbnailURL = getAssetURL(cfg, assetPath);
  videoMeta.thumbnailURL = thumbnailURL;

  updateVideo(cfg.db, videoMeta);

  return respondWithJSON(200, videoMeta);
}
