// Minimální typy pro troika-three-text (SDF texty v three.js) — jen to, co používá 2D prohlížeč výkresů.
declare module "troika-three-text" {
  import type { Mesh, Object3D } from "three";

  export class Text extends Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    anchorX: number | string;
    anchorY: number | string;
    maxWidth: number;
    lineHeight: number | string;
    color: number | string;
    sync(callback?: () => void): void;
    dispose(): void;
  }

  export class BatchedText extends Object3D {
    add(...objects: Object3D[]): this;
    sync(callback?: () => void): void;
    dispose(): void;
  }
}
