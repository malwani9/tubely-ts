import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import { s3, S3Client, stdout, type BunRequest } from "bun";
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
  
  const tempFilePath = "./temp/temp.mp4";
  await Bun.write(tempFilePath, videoFile);

  const ratio = await getVideoAspectRatio(tempFilePath);

  const client = cfg.s3Client;
  const s3File = client.file(`${ratio}/${videoId}.mp4`);

  await s3File.write(Bun.file(tempFilePath), {
    type: "video/mp4",
  });

  await Bun.file("./temp/temp.mp4").delete();
  
  let url  = `https://${cfg.s3Bucket}.s3.eu-north-1.amazonaws.com/${ratio}/${videoId}.mp4`;

  videoMeta.videoURL = url;
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

      if (await process.exited !== 0) {
        throw  new Error(`ffprobe error: ${stderrText}`);
      }

      const JsonOutput = JSON.parse(stdoutText);
      if (!JsonOutput.stream || JsonOutput.stream.length === 0) {
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
