"use client";
import dynamic from "next/dynamic";

// WebGL, speech and fonts only exist in the browser
const VideoPlayer = dynamic(() => import("../player/VideoPlayer"), { ssr: false });

export default function Page() {
  return <VideoPlayer />;
}
