import { loader } from "@monaco-editor/react";

// Configure Monaco to load from local files instead of CDN
// The vs folder is copied to public/monaco-editor/min/vs during Docker build
loader.config({
  paths: {
    vs: "/monaco-editor/min/vs",
  },
});
