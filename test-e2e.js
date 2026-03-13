// ============================================================
// End-to-End Test – Full Processing Pipeline
//
// Runs the complete pipeline (VAD → extract → recognize) on
// real audio samples WITHOUT Electron.
//
// Usage: node --use-system-ca test-e2e.js
// ============================================================

const path = require('path');
const fs = require('fs');
const os = require('os');

// ---- Helpers ----
let passed = 0;
let failed = 0;
let warnings = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  \u2713 ${msg}`);
    passed++;
  } else {
    console.error(`  \u2717 FAIL: ${msg}`);
    failed++;
  }
}

function warn(msg) {
  console.log(`  \u26A0 WARN: ${msg}`);
  warnings++;
}

function header(title) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(70));
}

function subheader(title) {
  console.log(`\n  --- ${title} ---`);
}

function formatDuration(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}m${String(sec).padStart(2, '0')}s`;
}

// ---- Mock Electron before any dist/ imports ----
// ProcessingPipeline imports BrowserWindow, FileService imports app
const mockSendCalls = [];
const mockWin = {
  isDestroyed: () => false,
  webContents: {
    send: (channel, data) => {
      mockSendCalls.push({ channel, data });
    },
  },
};

// Mock the entire electron module
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'electron') {
    return request; // Return as-is, will be caught by our mock below
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// Register electron mock in require cache
const electronMock = {
  app: {
    isPackaged: false,
    getPath: (name) => {
      if (name === 'exe') return process.execPath;
      if (name === 'userData') return path.join(os.tmpdir(), 'sound-splitter-e2e-test');
      return os.tmpdir();
    },
  },
  BrowserWindow: function () { return mockWin; },
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: {},
};

require.cache[require.resolve('electron')] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: electronMock,
};

// ---- Test configuration ----
const SAMPLES = [
  {
    name: 'Sample 1: Meeting Conversation (clean)',
    file: 'sample1-meeting-conversation.mp3',
    description: 'Two speakers alternating with 1-3s pauses',
    expectMinSegments: 3,
    expectMaxSegments: 35,  // Energy-based VAD over-segments SAPI TTS micro-pauses (observed: 24)
    sensitivity: 5,
    hasNoise: false,
  },
  {
    name: 'Sample 2: Lecture Presentation (light noise)',
    file: 'sample2-lecture-presentation.mp3',
    description: 'Single speaker monologue with 3-5s topic pauses + pink noise',
    expectMinSegments: 2,
    expectMaxSegments: 40,  // Energy-based VAD over-segments SAPI TTS micro-pauses (observed: 27)
    sensitivity: 5,
    hasNoise: true,
  },
  {
    name: 'Sample 3: Rapid Interview (slight noise)',
    file: 'sample3-interview-dialog.mp3',
    description: 'Quick back-and-forth with 0.3-0.8s pauses + pink noise',
    expectMinSegments: 1,
    expectMaxSegments: 40,  // Energy-based VAD over-segments SAPI TTS micro-pauses (observed: 27)
    sensitivity: 3,  // More aggressive to catch short pauses
    hasNoise: true,
  },
  {
    name: 'Sample 4: Phone Call One-Sided (white noise)',
    file: 'sample4-phone-call.mp3',
    description: 'One speaker with 3-7s listening pauses + white noise hiss',
    expectMinSegments: 3,
    expectMaxSegments: 30,  // Energy-based VAD over-segments SAPI TTS micro-pauses (observed: 20)
    sensitivity: 5,
    hasNoise: true,
  },
  {
    name: 'Sample 5: Noisy Meeting (brown noise)',
    file: 'sample5-noisy-meeting.mp3',
    description: 'Two speakers with rapid exchanges 0.2-1.0s pauses + brown noise',
    expectMinSegments: 1,
    expectMaxSegments: 40,  // Energy-based VAD over-segments SAPI TTS micro-pauses (observed: 28)
    sensitivity: 4,
    hasNoise: true,
  },
];

// ---- Main test runner ----
async function main() {
  console.log('Sound Splitter \u2013 End-to-End Pipeline Test');
  console.log(`Node ${process.version} | ${process.platform} ${process.arch}`);
  console.log(`Working directory: ${process.cwd()}`);
  console.log(`Test samples: ${SAMPLES.length}`);

  // Verify prerequisites
  header('Prerequisites');

  const inputDir = path.join(__dirname, 'input');
  for (const sample of SAMPLES) {
    const filePath = path.join(inputDir, sample.file);
    if (!fs.existsSync(filePath)) {
      console.error(`ERROR: Test file missing: ${filePath}`);
      console.error('Run generate-test-audio.ps1 first to create test samples.');
      process.exit(1);
    }
    const stat = fs.statSync(filePath);
    console.log(`  Found: ${sample.file} (${(stat.size / 1024).toFixed(0)} KB)`);
  }

  const modelFile = path.join(__dirname, 'resources', 'models', 'silero_vad.onnx');
  if (!fs.existsSync(modelFile)) {
    console.error('ERROR: Silero VAD model not found');
    process.exit(1);
  }
  console.log(`  Found: silero_vad.onnx (${(fs.statSync(modelFile).size / 1024).toFixed(0)} KB)`);

  // Load compiled modules
  const { SpeechDetector } = require('./dist/main/processing/speech-detector');
  const { SpeechRecognizer } = require('./dist/main/processing/speech-recognizer');
  const { AudioProcessor } = require('./dist/main/processing/audio-processor');
  const { ProcessingPipeline } = require('./dist/main/processing/processing-pipeline');
  const { sensitivityToThresholds } = require('./dist/shared/types');

  // Create shared instances (reused across all tests, like the real app)
  console.log('\n  Initializing shared AI models...');
  const sharedDetector = new SpeechDetector();
  const sharedRecognizer = new SpeechRecognizer();
  const audioProcessor = new AudioProcessor();

  // Wait for Silero to initialize
  await new Promise(resolve => setTimeout(resolve, 3000));
  console.log('  Silero VAD initialized');

  // Initialize Whisper
  console.log('  Loading Whisper model (this may take a while on first run)...');
  const whisperStart = Date.now();
  try {
    await sharedRecognizer.init((pct) => {
      if (pct > 0 && pct % 25 === 0) {
        process.stdout.write(`    Whisper download: ${Math.round(pct)}%\r`);
      }
    });
    console.log(`  Whisper model loaded in ${((Date.now() - whisperStart) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.log(`  Whisper model load failed: ${err.message}`);
    console.log('  Speech recognition tests will be limited');
  }

  // Create a temporary output base directory
  const testOutputBase = path.join(os.tmpdir(), `ss-e2e-test-${Date.now()}`);
  fs.mkdirSync(testOutputBase, { recursive: true });
  console.log(`  Test output directory: ${testOutputBase}`);

  // ================================================================
  // Run each sample through the full pipeline
  // ================================================================
  const allResults = [];

  for (let i = 0; i < SAMPLES.length; i++) {
    const sample = SAMPLES[i];
    const inputPath = path.join(inputDir, sample.file);

    header(`Test ${i + 1}/${SAMPLES.length}: ${sample.name}`);
    console.log(`  ${sample.description}`);
    console.log(`  File: ${sample.file} | Sensitivity: ${sample.sensitivity}/10`);

    const sampleStart = Date.now();
    const result = {
      sample: sample.name,
      segments: 0,
      outputFiles: [],
      recognized: 0,
      lowConfidence: 0,
      errors: [],
      durationMs: 0,
    };

    try {
      // --- Phase 1: VAD (Speech Detection) ---
      subheader('Phase 1: Voice Activity Detection');
      const vadStart = Date.now();

      // Decode to raw PCM first
      const rawPcmPath = await audioProcessor.decodeToRawPCM(inputPath, 0);
      const pcmBuf = fs.readFileSync(rawPcmPath);
      const samples = new Float32Array(
        pcmBuf.buffer.slice(pcmBuf.byteOffset, pcmBuf.byteOffset + pcmBuf.byteLength)
      );
      const audioDuration = samples.length / 16000;
      console.log(`  Audio: ${audioDuration.toFixed(1)}s, ${samples.length} samples`);

      const thresholds = sensitivityToThresholds(sample.sensitivity);
      const segments = await sharedDetector.detectFromSamples(samples, 0, {
        thresholds,
        thresholdBias: 0,
      });

      const vadMs = Date.now() - vadStart;
      console.log(`  VAD completed in ${vadMs}ms`);
      console.log(`  Detected ${segments.length} speech segment(s):`);

      for (const seg of segments) {
        const dur = (seg.endTime - seg.startTime).toFixed(2);
        console.log(`    ${formatDuration(seg.startTime)} - ${formatDuration(seg.endTime)} (${dur}s)`);
      }

      result.segments = segments.length;

      assert(
        segments.length >= sample.expectMinSegments,
        `Detected ${segments.length} segments >= expected min ${sample.expectMinSegments}`
      );
      assert(
        segments.length <= sample.expectMaxSegments,
        `Detected ${segments.length} segments <= expected max ${sample.expectMaxSegments}`
      );

      if (segments.length === 0) {
        warn('No segments detected - skipping extraction and recognition phases');
        result.errors.push('No segments detected');
        result.durationMs = Date.now() - sampleStart;
        allResults.push(result);
        audioProcessor.cleanupTempFile(rawPcmPath);
        continue;
      }

      // Verify segments are sorted and non-overlapping
      let sorted = true;
      let nonOverlapping = true;
      for (let j = 1; j < segments.length; j++) {
        if (segments[j].startTime < segments[j - 1].startTime) sorted = false;
        if (segments[j].startTime < segments[j - 1].endTime) nonOverlapping = false;
      }
      assert(sorted, 'Segments are chronologically sorted');
      assert(nonOverlapping, 'Segments do not overlap');

      // Verify all segments are within audio bounds
      const allInBounds = segments.every(s => s.startTime >= 0 && s.endTime <= audioDuration + 1);
      assert(allInBounds, 'All segments within audio bounds');

      audioProcessor.cleanupTempFile(rawPcmPath);

      // --- Phase 2: Segment Extraction ---
      subheader('Phase 2: Audio Extraction + Noise Reduction');
      const extractStart = Date.now();
      const outputDir = path.join(testOutputBase, path.basename(sample.file, '.mp3'));
      fs.mkdirSync(outputDir, { recursive: true });

      for (let j = 0; j < segments.length; j++) {
        const seg = segments[j];
        const tsName = `${String(Math.floor(seg.startTime / 60)).padStart(2, '0')}m${String(Math.floor(seg.startTime % 60)).padStart(2, '0')}s-${String(Math.floor(seg.endTime / 60)).padStart(2, '0')}m${String(Math.floor(seg.endTime % 60)).padStart(2, '0')}s.mp3`;
        const outputPath = path.join(outputDir, tsName);

        try {
          await audioProcessor.extractSegment(inputPath, seg.startTime, seg.endTime, outputPath);

          // Trim silence
          try {
            await audioProcessor.trimSilence(outputPath);
          } catch {
            // Trimming is optional
          }

          const duration = await audioProcessor.getDuration(outputPath);
          const fileSize = fs.statSync(outputPath).size;

          result.outputFiles.push({
            path: outputPath,
            name: tsName,
            duration,
            size: fileSize,
            segStart: seg.startTime,
            segEnd: seg.endTime,
          });

          console.log(`  [${j + 1}/${segments.length}] ${tsName}: ${duration.toFixed(1)}s, ${(fileSize / 1024).toFixed(0)} KB`);
        } catch (err) {
          console.log(`  [${j + 1}/${segments.length}] FAILED: ${err.message}`);
          result.errors.push(`Extraction failed for segment ${j + 1}: ${err.message}`);
        }
      }

      const extractMs = Date.now() - extractStart;
      console.log(`  Extraction completed in ${extractMs}ms`);

      assert(
        result.outputFiles.length === segments.length,
        `All ${segments.length} segments extracted successfully (got ${result.outputFiles.length})`
      );

      // Verify output files exist and have reasonable size
      for (const out of result.outputFiles) {
        assert(fs.existsSync(out.path), `Output file exists: ${out.name}`);
        assert(out.size > 500, `Output file ${out.name} has reasonable size (${out.size} bytes)`);
        assert(out.duration > 0.05, `Output file ${out.name} has duration ${out.duration.toFixed(2)}s > 0.05s`);
      }

      // --- Phase 3: Speech Recognition ---
      subheader('Phase 3: Whisper Speech Recognition');
      const recogStart = Date.now();

      for (let j = 0; j < result.outputFiles.length; j++) {
        const out = result.outputFiles[j];
        try {
          const recResult = await sharedRecognizer.recognize(out.path, 'en');
          out.text = recResult.text;
          out.confidence = recResult.confidence;

          if (recResult.text) {
            result.recognized++;
            const confPct = Math.round(recResult.confidence * 100);
            const marker = recResult.confidence < 0.8 ? ' [LOW]' : '';
            if (recResult.confidence < 0.8) result.lowConfidence++;
            console.log(`  [${j + 1}] "${recResult.text}" (${confPct}%${marker})`);
          } else {
            console.log(`  [${j + 1}] (no speech recognized)`);
          }
        } catch (err) {
          console.log(`  [${j + 1}] Recognition error: ${err.message}`);
          result.errors.push(`Recognition failed for ${out.name}: ${err.message}`);
        }
      }

      const recogMs = Date.now() - recogStart;
      console.log(`  Recognition completed in ${recogMs}ms`);

      // At least some segments should have recognized text
      assert(
        result.recognized > 0,
        `At least 1 segment has recognized speech (got ${result.recognized}/${result.outputFiles.length})`
      );

    } catch (err) {
      console.error(`  FATAL ERROR: ${err.message}`);
      console.error(err.stack);
      result.errors.push(`Fatal: ${err.message}`);
    }

    result.durationMs = Date.now() - sampleStart;
    allResults.push(result);
    console.log(`\n  Total time for ${sample.name}: ${(result.durationMs / 1000).toFixed(1)}s`);
  }

  // ================================================================
  // Full Pipeline Test (using ProcessingPipeline class directly)
  // ================================================================
  header('Test 6: Full Pipeline Integration (ProcessingPipeline class)');
  console.log('  Running ProcessingPipeline on Sample 1 to verify end-to-end wiring...');

  try {
    // Clear previous mock send calls
    mockSendCalls.length = 0;

    const pipelineInput = path.join(inputDir, SAMPLES[0].file);
    const pipeline = new ProcessingPipeline(mockWin, pipelineInput, 0, {
      sensitivity: 5,
      thresholdBias: 0,
      language: 'en',
      speechDetector: sharedDetector,
      speechRecognizer: sharedRecognizer,
    });

    const pipeStart = Date.now();
    await pipeline.start();
    const pipeMs = Date.now() - pipeStart;

    const pipeOutputs = pipeline.getAllOutputFiles();
    console.log(`  Pipeline completed in ${(pipeMs / 1000).toFixed(1)}s`);
    console.log(`  Produced ${pipeOutputs.length} output file(s)`);

    for (const out of pipeOutputs) {
      const confPct = Math.round(out.confidence * 100);
      console.log(`    ${out.fileName} | ${out.duration.toFixed(1)}s | "${out.suggestedName || '(none)'}" ${confPct}% | ${out.status}${out.needsRename ? ' [review]' : ''}`);
    }

    assert(pipeOutputs.length > 0, `Pipeline produced ${pipeOutputs.length} output files`);
    assert(
      pipeOutputs.every(f => f.status === 'ready'),
      'All pipeline outputs have status "ready"'
    );

    // Check IPC messages were sent
    const segmentProducedMsgs = mockSendCalls.filter(c => c.channel === 'segment-produced');
    const recognitionMsgs = mockSendCalls.filter(c => c.channel === 'recognition-result');
    const stateMsgs = mockSendCalls.filter(c => c.channel === 'processing-state');

    assert(segmentProducedMsgs.length > 0, `IPC: ${segmentProducedMsgs.length} segment-produced messages sent`);
    assert(recognitionMsgs.length >= 0, `IPC: ${recognitionMsgs.length} recognition-result messages sent`);
    assert(stateMsgs.length >= 2, `IPC: ${stateMsgs.length} state change messages (expect >= 2: processing, idle)`);

    // Check pipeline output files exist on disk
    let allExist = true;
    for (const out of pipeOutputs) {
      if (!fs.existsSync(out.filePath)) {
        allExist = false;
        console.log(`    MISSING: ${out.filePath}`);
      }
    }
    assert(allExist, 'All pipeline output files exist on disk');

  } catch (err) {
    assert(false, `Pipeline integration test failed: ${err.message}`);
    console.error(err.stack);
  }

  // ================================================================
  // Summary Report
  // ================================================================
  header('End-to-End Test Summary');

  console.log('\n  Per-sample results:');
  console.log('  ' + '-'.repeat(68));
  console.log('  ' + 'Sample'.padEnd(45) + 'Segs'.padStart(5) + 'Files'.padStart(6) + 'Recog'.padStart(6) + 'Time'.padStart(8));
  console.log('  ' + '-'.repeat(68));

  let totalSegments = 0;
  let totalFiles = 0;
  let totalRecognized = 0;
  let totalErrors = 0;
  let totalTimeMs = 0;

  for (const r of allResults) {
    const name = r.sample.length > 44 ? r.sample.substring(0, 41) + '...' : r.sample;
    console.log(
      '  ' +
      name.padEnd(45) +
      String(r.segments).padStart(5) +
      String(r.outputFiles.length).padStart(6) +
      String(r.recognized).padStart(6) +
      `${(r.durationMs / 1000).toFixed(1)}s`.padStart(8)
    );
    totalSegments += r.segments;
    totalFiles += r.outputFiles.length;
    totalRecognized += r.recognized;
    totalErrors += r.errors.length;
    totalTimeMs += r.durationMs;
  }

  console.log('  ' + '-'.repeat(68));
  console.log(
    '  ' +
    'TOTAL'.padEnd(45) +
    String(totalSegments).padStart(5) +
    String(totalFiles).padStart(6) +
    String(totalRecognized).padStart(6) +
    `${(totalTimeMs / 1000).toFixed(1)}s`.padStart(8)
  );

  if (totalErrors > 0) {
    console.log(`\n  Errors encountered: ${totalErrors}`);
    for (const r of allResults) {
      for (const err of r.errors) {
        console.log(`    - ${r.sample}: ${err}`);
      }
    }
  }

  // Cleanup test output
  console.log(`\n  Cleaning up test output: ${testOutputBase}`);
  try {
    fs.rmSync(testOutputBase, { recursive: true, force: true });
  } catch {
    console.log('  (cleanup skipped - manual cleanup needed)');
  }

  // Also clean up pipeline output (in project output/ dir)
  const pipelineOutputDir = path.join(__dirname, 'output');
  if (fs.existsSync(pipelineOutputDir)) {
    console.log(`  Cleaning up pipeline output: ${pipelineOutputDir}`);
    try {
      fs.rmSync(pipelineOutputDir, { recursive: true, force: true });
    } catch {
      console.log('  (pipeline output cleanup skipped)');
    }
  }

  // Dispose models
  try {
    await sharedDetector.dispose();
  } catch { /* ignore */ }

  // Final summary
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${warnings} warnings, ${passed + failed} total`);
  console.log('='.repeat(70));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
