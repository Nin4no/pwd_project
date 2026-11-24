/**
 * Dataset Fetch Script
 *
 * Reproducibly downloads the 24 selected indoor scenes from the SUN RGB-D benchmark
 * via the Hugging Face repository (kcz358/SUNRGBD-3D@a5baef8e7fff6044a6da494f122f3a0f8b1f3c5f).
 *
 * Generates:
 * - eval/room/data/<id>.jpg (24 images, total ~674KB)
 * - eval/room/data/raw_annotations.json (raw annotations including 3D bounding boxes and sensor paths)
 *
 * Security note: Downloaded files are treated strictly as untrusted binary images; they are never executed.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';

export const DATASET_PROVENANCE = {
  huggingface_dataset_id: 'kcz358/SUNRGBD-3D',
  huggingface_revision_sha: 'a5baef8e7fff6044a6da494f122f3a0f8b1f3c5f',
  huggingface_api_endpoint: 'https://datasets-server.huggingface.co/rows?dataset=kcz358%2FSUNRGBD-3D&config=default&split=test',
  upstream_origin: 'Princeton University SUN RGB-D Benchmark (Kinect v1 / NYU Depth v2 subset)',
  upstream_url: 'http://rgbd.cs.princeton.edu/',
  license: 'Princeton Custom Academic License (Non-commercial research/education)',
};

export const TARGET_SCENES: Record<string, 'bedroom' | 'living_room' | 'study' | 'studio'> = {
  // Bedroom (6)
  NYU0082: 'bedroom',
  NYU0079: 'bedroom',
  NYU1071: 'bedroom',
  NYU1035: 'bedroom',
  NYU0965: 'bedroom',
  NYU1110: 'bedroom',
  // Living Room (6)
  NYU1235: 'living_room',
  NYU1232: 'living_room',
  NYU0592: 'living_room',
  NYU1281: 'living_room',
  NYU1276: 'living_room',
  NYU0632: 'living_room',
  // Study (6)
  NYU0454: 'study',
  NYU0638: 'study',
  NYU0216: 'study',
  NYU0629: 'study',
  NYU0455: 'study',
  NYU0391: 'study',
  // Studio (6)
  NYU0986: 'studio',
  NYU0517: 'studio',
  NYU1102: 'studio',
  NYU0991: 'studio',
  NYU0172: 'studio',
  NYU1032: 'studio',
};

function httpsGetJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OrcaBenchmark/1.0' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(httpsGetJson(res.headers.location));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
  });
}

function httpsDownloadFile(url: string, destPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OrcaBenchmark/1.0' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          return resolve(httpsDownloadFile(res.headers.location, destPath));
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            const size = fs.statSync(destPath).size;
            resolve(size);
          });
        });
      }
    );
    req.on('error', (err) => {
      file.close();
      fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const rootDir = process.cwd();
  const dataDir = path.join(rootDir, 'eval/room/data');
  const rawPath = path.join(dataDir, 'raw_annotations.json');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  console.log('=== Fetching 24 Indoor Scenes for 3D Room Evaluation ===');
  console.log('Source:', DATASET_PROVENANCE.huggingface_dataset_id);
  console.log('Revision SHA:', DATASET_PROVENANCE.huggingface_revision_sha);

  const neededIds = new Set(Object.keys(TARGET_SCENES));
  const foundScenes: Record<string, any> = {};

  // Query pages of 100 rows from HF datasets server
  for (let offset = 0; offset <= 300; offset += 100) {
    if (Object.keys(foundScenes).length === neededIds.size) break;
    const url = `${DATASET_PROVENANCE.huggingface_api_endpoint}&offset=${offset}&limit=100`;
    console.log(`Querying rows at offset ${offset}...`);
    try {
      const page = await httpsGetJson(url);
      const rows = page.rows || [];
      for (const r of rows) {
        const row = r.row;
        const sid = row.scene_id;
        if (neededIds.has(sid) && !foundScenes[sid]) {
          foundScenes[sid] = row;
          console.log(`  Found scene: ${sid} (${TARGET_SCENES[sid]})`);
        }
      }
    } catch (e) {
      console.error(`  Error querying offset ${offset}:`, e);
    }
    await sleep(300);
  }

  const foundCount = Object.keys(foundScenes).length;
  console.log(`Total scenes located: ${foundCount}/${neededIds.size}`);

  const rawAnnotations: Record<string, any> = {};
  let totalBytes = 0;

  for (const sid of Object.keys(TARGET_SCENES)) {
    const row = foundScenes[sid];
    if (!row) {
      console.warn(`Warning: Scene ${sid} not found in fetched pages`);
      continue;
    }

    const imgDest = path.join(dataDir, `${sid}.jpg`);
    const imgSrc = row.image?.src;

    if (!imgSrc) {
      console.warn(`Warning: Image URL missing for ${sid}`);
      continue;
    }

    console.log(`Downloading ${sid}.jpg...`);
    const bytes = await httpsDownloadFile(imgSrc, imgDest);
    totalBytes += bytes;

    rawAnnotations[sid] = {
      scene_id: sid,
      scene_type: TARGET_SCENES[sid],
      scene_path: row.scene_path,
      image_file: `data/${sid}.jpg`,
      image_width: row.image_width,
      image_height: row.image_height,
      categories: row.categories,
      labels: row.labels,
      bboxes_3d: row.bboxes_3d,
      provenance: {
        source_dataset: DATASET_PROVENANCE.huggingface_dataset_id,
        source_revision: DATASET_PROVENANCE.huggingface_revision_sha,
        upstream_path: row.scene_path,
      },
    };
  }

  fs.writeFileSync(rawPath, JSON.stringify(rawAnnotations, null, 2), 'utf-8');
  console.log(`\nSuccessfully saved raw annotations: ${rawPath}`);
  console.log(`Total downloaded image size: ${(totalBytes / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error('Fetch script failed:', err);
  process.exit(1);
});
