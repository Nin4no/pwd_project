/**
 * 생성 GLB 품질 측정 도구 (glb-metrics.ts)
 * 
 * 측정 지표:
 *  - 정점·삼각형 수 (vertexCount, triangleCount)
 *  - 바운딩 박스 (원본 단위) 및 목표 치수로 정규화한 스케일 (--target=w,d,h)
 *  - 바닥 정렬 오프셋 (floorAlignmentOffset)
 *  - 축 판정 (axisCheck: Y-up 여부, 가장 긴 축이 높이인 가구 ②③ 판정)
 *  - 텍스처 유무 (hasTexture) 및 파일 크기 (fileSizeBytes)
 *  - 반듯함 지표 (axisAlignedAreaRatio): 삼각형 법선이 6개 축(±X±Y±Z)과 10° 이내인 면적 비율
 * 
 * 사용법:
 *  npx tsx eval/furniture/scripts/glb-metrics.ts
 *  npx tsx eval/furniture/scripts/glb-metrics.ts --file=eval/furniture/poc/1_A.glb
 *  npx tsx eval/furniture/scripts/glb-metrics.ts --target=1.0,0.3,1.2
 *  npx tsx eval/furniture/scripts/glb-metrics.ts --sample
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Polyfill FileReader for Three.js exporters in Node
if (typeof (globalThis as any).FileReader === 'undefined') {
  (globalThis as any).FileReader = class FileReader {
    result: any = null;
    onloadend: any = null;
    readAsArrayBuffer(blob: Blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../../..');
const POC_DIR = path.join(ROOT, 'eval/furniture/poc');
const DEFAULT_OUT = path.join(POC_DIR, 'metrics.json');

// 프리픽스별 기본 가구 목표 규격 표 (가로 w × 깊이 d × 높이 h, m)
// 1 선반 1.0×0.3×1.2, 2 냉장고 0.6×0.68×1.8, 3 책장 0.8×0.3×1.6, 4 식탁 1.2×0.75×0.74, 5 소파 0.85×0.85×0.8
export interface TargetSpec {
  prefix: number;
  category: string;
  w: number; // width (X축)
  d: number; // depth (Z축)
  h: number; // height (Y축)
  heightIsLongest: boolean;
}

export const TARGET_SPECS: Record<number, TargetSpec> = {
  1: { prefix: 1, category: '선반', w: 1.0, d: 0.3, h: 1.2, heightIsLongest: true },
  2: { prefix: 2, category: '냉장고', w: 0.6, d: 0.68, h: 1.8, heightIsLongest: true },
  3: { prefix: 3, category: '책장', w: 0.8, d: 0.3, h: 1.6, heightIsLongest: true },
  4: { prefix: 4, category: '식탁', w: 1.2, d: 0.75, h: 0.74, heightIsLongest: false },
  5: { prefix: 5, category: '소파', w: 0.85, d: 0.85, h: 0.8, heightIsLongest: false },
};

export interface GLBMetricResult {
  file: string;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  hasTexture: boolean;
  vertexCount: number;
  triangleCount: number;
  meshCount: number;
  primitiveCount: number;
  boundingBox: {
    raw: {
      min: [number, number, number];
      max: [number, number, number];
      size: [number, number, number];
      width_m: number;
      height_m: number;
      depth_m: number;
    };
  };
  target: {
    category: string;
    width_m: number;
    depth_m: number;
    height_m: number;
    source: string;
  };
  normalizedScale: {
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    uniformScale: number;
    appliedSize: [number, number, number];
  };
  floorAlignmentOffset: {
    rawYOffset: number;
    normalizedYOffset: number;
  };
  axisCheck: {
    longestAxis: 'X' | 'Y' | 'Z';
    isYUp: boolean;
    heightIsLongestExpected: boolean;
    verdict: string;
  };
  straightness: {
    totalSurfaceArea: number;
    axisAlignedArea: number;
    axisAlignedAreaRatio: number; // 0.0 ~ 1.0
    percentage: string;
    breakdown: {
      xAlignedArea: number;
      yAlignedArea: number;
      zAlignedArea: number;
    };
  };
  measuredAt: string;
}

interface AccessorData {
  array: Float32Array | Uint16Array | Uint32Array | Uint8Array;
  count: number;
  itemSize: number;
}

function getAccessor(json: any, bin: Buffer, index: number): AccessorData {
  const accessor = json.accessors[index];
  const bufferView = json.bufferViews[accessor.bufferView];
  const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const count = accessor.count;

  const typeMap: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const itemSize = typeMap[accessor.type] || 1;
  const total = count * itemSize;

  const compType = accessor.componentType;
  let bytesPerElement = 4;
  if (compType === 5126) bytesPerElement = 4; // FLOAT
  else if (compType === 5123) bytesPerElement = 2; // UNSIGNED_SHORT
  else if (compType === 5125) bytesPerElement = 4; // UNSIGNED_INT
  else if (compType === 5121) bytesPerElement = 1; // UNSIGNED_BYTE

  const slice = bin.subarray(byteOffset, byteOffset + total * bytesPerElement);
  const aligned = new Uint8Array(slice).buffer;

  let array: any;
  if (compType === 5126) array = new Float32Array(aligned);
  else if (compType === 5123) array = new Uint16Array(aligned);
  else if (compType === 5125) array = new Uint32Array(aligned);
  else if (compType === 5121) array = new Uint8Array(aligned);
  else throw new Error('Unsupported glTF componentType: ' + compType);

  return { array, count, itemSize };
}

/**
 * GLB 파싱 및 품질 측정 함수
 */
export function measureGLB(
  filePath: string,
  targetOverride?: { w: number; d: number; h: number }
): GLBMetricResult {
  const buf = fs.readFileSync(filePath);
  const stats = fs.statSync(filePath);
  const baseName = path.basename(filePath);

  // 1. GLB 헤더 검증
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546C67) {
    throw new Error(`Invalid GLB magic header: 0x${magic.toString(16)} in ${filePath}`);
  }
  const version = buf.readUInt32LE(4);
  const totalLength = buf.readUInt32LE(8);

  // 2. Chunk 0 (JSON) 및 Chunk 1 (BIN) 파싱
  const chunk0Len = buf.readUInt32LE(12);
  const chunk0Type = buf.readUInt32LE(16);
  if (chunk0Type !== 0x4E4F534A) {
    throw new Error(`Expected JSON chunk at offset 12, got type 0x${chunk0Type.toString(16)}`);
  }
  const jsonStr = buf.subarray(20, 20 + chunk0Len).toString('utf8');
  const json = JSON.parse(jsonStr);

  let binOffset = 20 + chunk0Len;
  if (binOffset % 4 !== 0) binOffset += 4 - (binOffset % 4);
  let bin = Buffer.alloc(0);
  if (binOffset < totalLength && binOffset < buf.length) {
    const binLen = buf.readUInt32LE(binOffset);
    const binType = buf.readUInt32LE(binOffset + 4);
    if (binType === 0x004E4942) {
      bin = buf.subarray(binOffset + 8, binOffset + 8 + binLen);
    }
  }

  // 3. 텍스처 유무 검사
  const hasTexture = Boolean(
    (json.textures && json.textures.length > 0) ||
      (json.images && json.images.length > 0) ||
      (json.materials &&
        json.materials.some(
          (m: any) =>
            m.pbrMetallicRoughness?.baseColorTexture ||
            m.normalTexture ||
            m.emissiveTexture ||
            m.occlusionTexture
        ))
  );

  // 4. 노드 계층구조 탐색으로 메시별 월드 변환 행렬 누적
  const meshInstances: Array<{ meshIndex: number; worldMatrix: THREE.Matrix4 }> = [];

  function visitNode(nodeIndex: number, parentMatrix: THREE.Matrix4) {
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    const local = new THREE.Matrix4();
    if (node.matrix) {
      local.fromArray(node.matrix);
    } else {
      const pos = node.translation ? new THREE.Vector3(...node.translation) : new THREE.Vector3();
      const rot = node.rotation ? new THREE.Quaternion(...node.rotation) : new THREE.Quaternion();
      const scale = node.scale ? new THREE.Vector3(...node.scale) : new THREE.Vector3(1, 1, 1);
      local.compose(pos, rot, scale);
    }
    const world = parentMatrix.clone().multiply(local);
    if (typeof node.mesh === 'number') {
      meshInstances.push({ meshIndex: node.mesh, worldMatrix: world });
    }
    if (Array.isArray(node.children)) {
      for (const childIdx of node.children) {
        visitNode(childIdx, world);
      }
    }
  }

  const defaultScene = json.scenes?.[json.scene || 0];
  const rootNodes: number[] =
    defaultScene?.nodes || (json.nodes ? json.nodes.map((_: any, i: number) => i) : []);
  for (const rootIdx of rootNodes) {
    visitNode(rootIdx, new THREE.Matrix4());
  }

  // 만약 씬 그래프에 메시 인스턴스가 없으면 meshes 배열 직접 순회 (단위 행렬)
  if (meshInstances.length === 0 && Array.isArray(json.meshes)) {
    for (let i = 0; i < json.meshes.length; i++) {
      meshInstances.push({ meshIndex: i, worldMatrix: new THREE.Matrix4() });
    }
  }

  // 5. 정점, 삼각형, 바운딩 박스, 반듯함(axisAlignedAreaRatio) 계산
  let totalVertices = 0;
  let totalTriangles = 0;
  let primitiveCount = 0;
  const bbox = new THREE.Box3();
  let totalArea = 0;
  let alignedArea = 0;
  let xAlignedArea = 0;
  let yAlignedArea = 0;
  let zAlignedArea = 0;

  // 10도 이내: cos(10 deg) = 0.984807753012208
  const cos10 = Math.cos((10 * Math.PI) / 180);

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (const inst of meshInstances) {
    const mesh = json.meshes[inst.meshIndex];
    if (!mesh || !Array.isArray(mesh.primitives)) continue;

    for (const prim of mesh.primitives) {
      if (typeof prim.attributes?.POSITION !== 'number') continue;
      primitiveCount++;

      const posAcc = getAccessor(json, bin, prim.attributes.POSITION);
      totalVertices += posAcc.count;
      const posArray = posAcc.array as Float32Array;

      let indexArray: (Uint16Array | Uint32Array | Uint8Array) | null = null;
      let triCount = 0;
      if (typeof prim.indices === 'number') {
        const indAcc = getAccessor(json, bin, prim.indices);
        indexArray = indAcc.array as any;
        triCount = Math.floor(indAcc.count / 3);
      } else {
        triCount = Math.floor(posAcc.count / 3);
      }
      totalTriangles += triCount;

      for (let t = 0; t < triCount; t++) {
        let i0 = 3 * t;
        let i1 = 3 * t + 1;
        let i2 = 3 * t + 2;
        if (indexArray) {
          i0 = indexArray[3 * t];
          i1 = indexArray[3 * t + 1];
          i2 = indexArray[3 * t + 2];
        }

        v0.set(posArray[3 * i0], posArray[3 * i0 + 1], posArray[3 * i0 + 2]).applyMatrix4(
          inst.worldMatrix
        );
        v1.set(posArray[3 * i1], posArray[3 * i1 + 1], posArray[3 * i1 + 2]).applyMatrix4(
          inst.worldMatrix
        );
        v2.set(posArray[3 * i2], posArray[3 * i2 + 1], posArray[3 * i2 + 2]).applyMatrix4(
          inst.worldMatrix
        );

        bbox.expandByPoint(v0);
        bbox.expandByPoint(v1);
        bbox.expandByPoint(v2);

        e1.subVectors(v1, v0);
        e2.subVectors(v2, v0);
        normal.crossVectors(e1, e2);
        const len = normal.length();
        if (len < 1e-10) continue; // 면적이 0인 축퇴(degenerate) 삼각형

        const area = 0.5 * len;
        totalArea += area;

        // 단위 법선 벡터
        normal.multiplyScalar(1 / len);
        const absX = Math.abs(normal.x);
        const absY = Math.abs(normal.y);
        const absZ = Math.abs(normal.z);
        const maxDot = Math.max(absX, absY, absZ);

        if (maxDot >= cos10) {
          alignedArea += area;
          if (absX >= cos10) xAlignedArea += area;
          else if (absY >= cos10) yAlignedArea += area;
          else if (absZ >= cos10) zAlignedArea += area;
        }
      }
    }
  }

  // 6. 목표 치수 결정
  const rawSize = new THREE.Vector3();
  bbox.getSize(rawSize);

  let targetW = 1.0;
  let targetD = 1.0;
  let targetH = 1.0;
  let category = 'custom';
  let targetSource = 'default';
  let heightIsLongestExpected = false;

  if (targetOverride) {
    targetW = targetOverride.w;
    targetD = targetOverride.d;
    targetH = targetOverride.h;
    category = 'CLI-override';
    targetSource = `--target=${targetW},${targetD},${targetH}`;
    heightIsLongestExpected = targetH >= targetW && targetH >= targetD;
  } else {
    // 파일명 프리픽스 추출 (예: 1_A.glb -> 1, 3_bookcase.glb -> 3)
    const match = baseName.match(/^([1-5])[\b_-]/) || baseName.match(/^([1-5])/);
    if (match) {
      const p = parseInt(match[1], 10);
      const spec = TARGET_SPECS[p];
      if (spec) {
        targetW = spec.w;
        targetD = spec.d;
        targetH = spec.h;
        category = spec.category;
        targetSource = `Prefix ${p} (${spec.category})`;
        heightIsLongestExpected = spec.heightIsLongest;
      }
    }
  }

  // 7. 정규화 스케일 계산
  const safeX = rawSize.x > 1e-6 ? rawSize.x : 1;
  const safeY = rawSize.y > 1e-6 ? rawSize.y : 1;
  const safeZ = rawSize.z > 1e-6 ? rawSize.z : 1;

  const scaleX = targetW / safeX;
  const scaleY = targetH / safeY;
  const scaleZ = targetD / safeZ;
  const uniformScale = Math.min(scaleX, scaleY, scaleZ);

  // 8. 바닥 정렬 오프셋 (Y=0 기준)
  const rawYOffset = -bbox.min.y;
  const normalizedYOffset = -bbox.min.y * scaleY;

  // 9. 축 판정 (가장 긴 축 판별)
  let longestAxis: 'X' | 'Y' | 'Z' = 'Y';
  if (rawSize.x >= rawSize.y && rawSize.x >= rawSize.z) longestAxis = 'X';
  else if (rawSize.y >= rawSize.x && rawSize.y >= rawSize.z) longestAxis = 'Y';
  else longestAxis = 'Z';

  const isYUp = longestAxis === 'Y';
  let verdict = '';
  if (heightIsLongestExpected) {
    verdict = isYUp
      ? `Y-up 정렬 확인 (높이 축 Y가 가장 긴 축: ${round4(rawSize.y)}m)`
      : `축 불일치 의심 (예상 Y-up이나 가장 긴 축이 ${longestAxis}: ${round4(longestAxis === 'Z' ? rawSize.z : rawSize.x)}m)`;
  } else {
    verdict = `가장 긴 축 = ${longestAxis} (W:${round4(rawSize.x)}, H:${round4(rawSize.y)}, D:${round4(rawSize.z)})`;
  }

  // 10. 반듯함 지표
  const ratio = totalArea > 1e-6 ? alignedArea / totalArea : 0;
  const pct = (ratio * 100).toFixed(2) + '%';

  return {
    file: baseName,
    fileSizeBytes: stats.size,
    fileSizeFormatted: formatBytes(stats.size),
    hasTexture,
    vertexCount: totalVertices,
    triangleCount: totalTriangles,
    meshCount: json.meshes?.length || 0,
    primitiveCount,
    boundingBox: {
      raw: {
        min: [round4(bbox.min.x), round4(bbox.min.y), round4(bbox.min.z)],
        max: [round4(bbox.max.x), round4(bbox.max.y), round4(bbox.max.z)],
        size: [round4(rawSize.x), round4(rawSize.y), round4(rawSize.z)],
        width_m: round4(rawSize.x),
        height_m: round4(rawSize.y),
        depth_m: round4(rawSize.z),
      },
    },
    target: {
      category,
      width_m: targetW,
      depth_m: targetD,
      height_m: targetH,
      source: targetSource,
    },
    normalizedScale: {
      scaleX: round4(scaleX),
      scaleY: round4(scaleY),
      scaleZ: round4(scaleZ),
      uniformScale: round4(uniformScale),
      appliedSize: [round4(targetW), round4(targetH), round4(targetD)],
    },
    floorAlignmentOffset: {
      rawYOffset: round4(rawYOffset),
      normalizedYOffset: round4(normalizedYOffset),
    },
    axisCheck: {
      longestAxis,
      isYUp,
      heightIsLongestExpected,
      verdict,
    },
    straightness: {
      totalSurfaceArea: round4(totalArea),
      axisAlignedArea: round4(alignedArea),
      axisAlignedAreaRatio: round4(ratio),
      percentage: pct,
      breakdown: {
        xAlignedArea: round4(xAlignedArea),
        yAlignedArea: round4(yAlignedArea),
        zAlignedArea: round4(zAlignedArea),
      },
    },
    measuredAt: new Date().toISOString(),
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * 카탈로그 가구를 모사한 검증용 샘플 GLB 생성기 (선반 1.0x0.3x1.2, 책장 0.8x0.3x1.6)
 */
export async function generateSampleGLB(outDir: string): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const exporter = new GLTFExporter();
  const created: string[] = [];

  // 샘플 1: 1_sample_shelf.glb (선반 1.0 x 0.3 x 1.2)
  {
    const scene = new THREE.Scene();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7 });
    // 양 측판
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.2, 0.3), mat);
    left.position.set(-0.49, 0.6, 0);
    scene.add(left);
    const right = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.2, 0.3), mat);
    right.position.set(0.49, 0.6, 0);
    scene.add(right);
    // 4단 선반
    for (let i = 0; i < 4; i++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.02, 0.28), mat);
      shelf.position.set(0, 0.05 + i * (1.1 / 3), 0);
      scene.add(shelf);
    }
    const glb = (await new Promise<ArrayBuffer>((res, rej) =>
      exporter.parse(scene, (g) => res(g as ArrayBuffer), rej, { binary: true })
    )) as ArrayBuffer;
    const dest = path.join(outDir, '1_sample_shelf.glb');
    fs.writeFileSync(dest, Buffer.from(glb));
    created.push(dest);
  }

  // 샘플 2: 3_sample_bookcase.glb (책장 0.8 x 0.3 x 1.6)
  {
    const scene = new THREE.Scene();
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8c3a5, roughness: 0.8 });
    // 측판 2개
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.6, 0.3), mat);
    left.position.set(-0.39, 0.8, 0);
    scene.add(left);
    const right = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.6, 0.3), mat);
    right.position.set(0.39, 0.8, 0);
    scene.add(right);
    // 후면판
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.6, 0.01), mat);
    back.position.set(0, 0.8, -0.145);
    scene.add(back);
    // 5단 선반판
    for (let i = 0; i < 5; i++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.02, 0.28), mat);
      shelf.position.set(0, 0.05 + i * (1.5 / 4), 0);
      scene.add(shelf);
    }
    const glb = (await new Promise<ArrayBuffer>((res, rej) =>
      exporter.parse(scene, (g) => res(g as ArrayBuffer), rej, { binary: true })
    )) as ArrayBuffer;
    const dest = path.join(outDir, '3_sample_bookcase.glb');
    fs.writeFileSync(dest, Buffer.from(glb));
    created.push(dest);
  }

  return created;
}

// CLI 실행 엔트리포인트
async function main() {
  const args = process.argv.slice(2);
  let fileArg: string | undefined;
  let dirArg = POC_DIR;
  let targetArg: { w: number; d: number; h: number } | undefined;
  let outArg = DEFAULT_OUT;
  let sampleOnly = false;

  for (const arg of args) {
    if (arg.startsWith('--file=')) fileArg = path.resolve(process.cwd(), arg.slice(7));
    else if (arg.startsWith('--dir=')) dirArg = path.resolve(process.cwd(), arg.slice(6));
    else if (arg.startsWith('--out=')) outArg = path.resolve(process.cwd(), arg.slice(6));
    else if (arg.startsWith('--target=')) {
      const [w, d, h] = arg.slice(9).split(',').map(Number);
      if (!isNaN(w) && !isNaN(d) && !isNaN(h)) targetArg = { w, d, h };
    } else if (arg === '--sample') sampleOnly = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`
glb-metrics.ts - 생성 GLB 품질 측정 도구

옵션:
  --file=<경로>       단일 GLB 파일 분석
  --dir=<경로>        GLB 디렉터리 일괄 분석 (기본: eval/furniture/poc)
  --target=w,d,h      목표 치수(가로w, 깊이d, 높이h, m) 직접 지정
  --out=<경로>        결과 JSON 파일 경로 (기본: eval/furniture/poc/metrics.json)
  --sample            카탈로그 가구 기반 검증 샘플 GLB(1_sample_shelf, 3_sample_bookcase) 생성
      `);
      process.exit(0);
    }
  }

  fs.mkdirSync(dirArg, { recursive: true });

  let targetFiles: string[] = [];
  if (fileArg) {
    if (!fs.existsSync(fileArg)) {
      console.error(`Error: File not found: ${fileArg}`);
      process.exit(1);
    }
    targetFiles = [fileArg];
  } else {
    // 디렉터리 내 *.glb 검색
    let glbFiles = fs.readdirSync(dirArg).filter((f) => f.toLowerCase().endsWith('.glb'));
    if (glbFiles.length === 0 || sampleOnly) {
      console.log(`[INFO] '${dirArg}' 디렉터리에 GLB 파일이 없거나 --sample 요청됨.`);
      console.log(`[INFO] 앱 카탈로그 사양 기반 검증 샘플 GLB 생성 중...`);
      const created = await generateSampleGLB(dirArg);
      console.log(`[INFO] 생성된 샘플: ${created.map((f) => path.basename(f)).join(', ')}`);
      glbFiles = fs.readdirSync(dirArg).filter((f) => f.toLowerCase().endsWith('.glb'));
    }
    targetFiles = glbFiles.map((f) => path.join(dirArg, f));
  }

  console.log(`\n======================================================`);
  console.log(`  GLB 품질 지표 측정 (총 ${targetFiles.length}개 파일)`);
  console.log(`======================================================\n`);

  const results: Record<string, GLBMetricResult> = {};
  const rows: Array<Record<string, any>> = [];

  for (const f of targetFiles) {
    try {
      const res = measureGLB(f, targetArg);
      results[res.file] = res;
      rows.push({
        'File': res.file,
        'Size': res.fileSizeFormatted,
        'Vertices': res.vertexCount,
        'Triangles': res.triangleCount,
        'Raw Size (WxHxD m)': `${res.boundingBox.raw.width_m} × ${res.boundingBox.raw.height_m} × ${res.boundingBox.raw.depth_m}`,
        'Target (WxHxD m)': `${res.target.width_m} × ${res.target.height_m} × ${res.target.depth_m}`,
        'Norm Scale (X/Y/Z)': `${res.normalizedScale.scaleX} / ${res.normalizedScale.scaleY} / ${res.normalizedScale.scaleZ}`,
        'Floor Offset': `${res.floorAlignmentOffset.normalizedYOffset}m`,
        'Axis (Y-up?)': `${res.axisCheck.longestAxis} (${res.axisCheck.isYUp ? 'O' : 'X'})`,
        'Straightness': `${res.straightness.percentage} (${res.straightness.axisAlignedAreaRatio})`,
        'Texture': res.hasTexture ? 'Yes' : 'No',
      });
    } catch (err: any) {
      console.error(`[FAIL] ${path.basename(f)}:`, err.message);
    }
  }

  console.table(rows);

  // metrics.json 저장
  fs.mkdirSync(path.dirname(outArg), { recursive: true });
  fs.writeFileSync(outArg, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n[SUCCESS] 측정 결과 저장 완료: ${path.relative(ROOT, outArg)}`);
}

// 직접 실행 시 main() 호출
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((err) => {
    console.error('Fatal Error:', err);
    process.exit(1);
  });
}
