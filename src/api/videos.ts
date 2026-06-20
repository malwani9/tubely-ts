import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import { type BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo,  } from "../db/videos";
import { BadRequestError, UserForbiddenError } from "./errors";
import { uploadtoS3 } from "./s3";

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
  
  const tempFilePath = "./temp/temp.mp4";
  await Bun.write(tempFilePath, videoFile);

  const ratio = await getVideoAspectRatio(tempFilePath);

  const fastStartFile = await processVideoForFastStart(tempFilePath);
  let key  = `${ratio}/${videoId}.mp4`;

  await uploadtoS3(cfg, key, fastStartFile, "video/mp4");


  await Bun.file(tempFilePath).delete();
  await Bun.file(fastStartFile).delete();


  videoMeta.videoURL = `${cfg.s3CfDistribution}/${key}`;
  updateVideo(cfg.db, videoMeta);


  return respondWithJSON(200, null);
}


async function getVideoAspectRatio(filePath: string) {
    const process = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", 
      "stream=width,height", "-of", "json", filePath], {
        stdout: "pipe",
        stderr: "pipe"
      });

      const stdoutText = await new Response(process.stdout).text();
      const stderrText = await new Response(process.stderr).text();

      const exited = await process.exited
      if (exited !== 0) {
        throw  new Error(`ffprobe error: ${stderrText}`);
      }

      const JsonOutput = JSON.parse(stdoutText);
      if (!JsonOutput.streams || JsonOutput.streams.length === 0) {
        throw new Error(`No video stream found`);
      }
      const { width, height } = JsonOutput.streams[0];

      const ratio = classifyRatio(width, height);
      return ratio;
}

function classifyRatio(width: number, height: number) {
  const value = width / height;
  const tolerance = 0.1; // how much drift you'll forgive

  if (Math.abs(value - 16 / 9) <= tolerance) return "landscape";
  if (Math.abs(value - 9 / 16) <= tolerance) return "portrait";
  return "other";
}


async function processVideoForFastStart(inputFilePath: string) {

  let outputFilePath = inputFilePath.replace('.mp4','.processed.mp4');
  
  const process = Bun.spawn(["ffmpeg", "-i", inputFilePath, "-movflags", "faststart",
    "-map_metadata", "0", "-codec", "copy", "-f", "mp4", outputFilePath]);

  const exited = await process.exited
  if (exited !== 0) {
    throw  new Error(`ffprobe error: ${process.stderr}`);
  }

  return outputFilePath
}