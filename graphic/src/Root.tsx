import React from "react";
import { Composition } from "remotion";

import { Architecture } from "./Architecture";

const FPS = 30;

/** Six scenes, one per pattern the pipeline exercises. */
export const SCENE_FRAMES = 150;
export const SCENES = 6;

export const Root: React.FC = () => (
  <Composition
    id="Architecture"
    component={Architecture}
    durationInFrames={SCENE_FRAMES * SCENES}
    fps={FPS}
    width={1600}
    height={900}
  />
);
