'use client';

import { easeInOut, motion, useMotionValueEvent, useScroll, useTransform } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';

const TOTAL_FRAMES = 41;
const FRAME_PATHS = Array.from({ length: TOTAL_FRAMES }, (_, index) =>
  `/nova/frame-${String(index + 1).padStart(3, '0')}.jpg`,
);

export default function ProductScrollScene() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRefs = useRef<Array<HTMLImageElement | null>>([]);
  const lastRenderedFrame = useRef(-1);
  // Cached canvas geometry — resize logic no longer runs inside drawFrame.
  const canvasSize = useRef({ width: 0, height: 0, dpr: 1 });

  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Only touches canvas.width/height (which forces a backing-store
  // reallocation) — called on mount + actual resize events, never per-frame.
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(canvas.clientWidth || window.innerWidth, 1);
    const height = Math.max(canvas.clientHeight || window.innerHeight, 1);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const context = canvas.getContext('2d');
    if (context) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.scale(dpr, dpr);
    }

    canvasSize.current = { width, height, dpr };
  }, []);

  // Pure draw — no canvas.width/height writes here, so this is cheap
  // enough to run on every scroll-driven frame change.
  const drawFrame = useCallback((frameNumber: number) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const index = Math.min(Math.max(Math.round(frameNumber), 0), TOTAL_FRAMES - 1);
    const image = imageRefs.current[index];
    if (!image) return;

    const { width, height } = canvasSize.current;
    if (width === 0 || height === 0) return;

    context.clearRect(0, 0, width, height);

    const imageRatio = image.naturalWidth / image.naturalHeight;
    const viewportRatio = width / height;
    let drawWidth = width;
    let drawHeight = height;

    if (imageRatio > viewportRatio) {
      drawWidth = width;
      drawHeight = width / imageRatio;
    } else {
      drawHeight = height;
      drawWidth = height * imageRatio;
    }

    const offsetX = (width - drawWidth) / 2;
    const offsetY = (height - drawHeight) / 2;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
    lastRenderedFrame.current = index;
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handlePreferenceChange = () => setReducedMotion(mediaQuery.matches);

    handlePreferenceChange();
    mediaQuery.addEventListener('change', handlePreferenceChange);

    return () => mediaQuery.removeEventListener('change', handlePreferenceChange);
  }, []);

  useEffect(() => {
    // Establish canvas geometry before any draw call can run.
    resizeCanvas();

    if (reducedMotion) {
      drawFrame(0);
      return;
    }

    if (imagesLoaded) {
      drawFrame(0);
      return;
    }

    let isCancelled = false;

    const loadImage = (src: string, index: number) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new window.Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load ${src}`));
        image.src = src;
      }).then((image) => {
        imageRefs.current[index] = image;
        setLoadingProgress(((index + 1) / TOTAL_FRAMES) * 100);
      });

    Promise.all(FRAME_PATHS.map((src, index) => loadImage(src, index)))
      .then(() => {
        if (isCancelled) return;
        setLoadingProgress(100);
        setImagesLoaded(true);
        requestAnimationFrame(() => drawFrame(0));
      })
      .catch(() => {
        if (!isCancelled) {
          setLoadingProgress(100);
          setImagesLoaded(true);
          requestAnimationFrame(() => drawFrame(0));
        }
      });

    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawFrame, imagesLoaded, reducedMotion, resizeCanvas]);

  useEffect(() => {
    const handleResize = () => {
      resizeCanvas();
      if (!imagesLoaded && !reducedMotion) return;
      const latestFrame = lastRenderedFrame.current >= 0 ? lastRenderedFrame.current : 0;
      requestAnimationFrame(() => drawFrame(latestFrame));
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [drawFrame, imagesLoaded, reducedMotion, resizeCanvas]);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  const frameIndex = useTransform(scrollYProgress, [0, 1], [0, TOTAL_FRAMES - 1]);

  useMotionValueEvent(frameIndex, 'change', (latest) => {
    if (reducedMotion) return;

    const clampedIndex = Math.min(Math.max(Math.round(latest), 0), TOTAL_FRAMES - 1);
    if (clampedIndex === lastRenderedFrame.current) return;

    requestAnimationFrame(() => drawFrame(clampedIndex));
  });

  // Non-overlapping opacity windows: each section fully exits (→ 0) before
  // the next one starts rising, with eased curves instead of linear fades.
  // `easeInOut` here is Framer Motion's exported EasingFunction, not the
  // string form — useTransform's `options.ease` requires a function.
  const transformEase = { ease: easeInOut };

  const sectionOneOpacity = useTransform(
    scrollYProgress,
    [0, 0.14, 0.2],
    [1, 1, 0],
    transformEase,
  );
  const sectionOneY = useTransform(scrollYProgress, [0, 0.14, 0.2], [0, -8, 20], transformEase);

  const sectionTwoOpacity = useTransform(
    scrollYProgress,
    [0.22, 0.28, 0.4, 0.46],
    [0, 1, 1, 0],
    transformEase,
  );
  const sectionTwoX = useTransform(scrollYProgress, [0.22, 0.3], [18, 0], transformEase);

  const sectionThreeOpacity = useTransform(
    scrollYProgress,
    [0.5, 0.56, 0.68, 0.74],
    [0, 1, 1, 0],
    transformEase,
  );
  const sectionThreeX = useTransform(scrollYProgress, [0.5, 0.58], [-24, 0], transformEase);

  const sectionFourOpacity = useTransform(
    scrollYProgress,
    [0.8, 0.86, 1],
    [0, 1, 1],
    transformEase,
  );
  const sectionFourY = useTransform(scrollYProgress, [0.8, 0.9], [10, 0], transformEase);

  const scrollHintOpacity = useTransform(scrollYProgress, [0, 0.04, 0.12], [1, 0.5, 0]);
  const progressBarScaleX = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <div ref={containerRef} className="relative h-[400vh] bg-[#050505] text-white">
      <div className="sticky top-0 h-screen w-full overflow-hidden bg-[#050505]">
        {/* Scroll progress indicator */}
        <motion.div
          className="pointer-events-none absolute inset-x-0 top-0 z-40 h-[2px] origin-left bg-white/70"
          style={{ scaleX: progressBarScaleX }}
        />

        {/* Minimal nav */}
        <nav className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-6 py-5 sm:px-10">
          <span className="text-xs font-medium uppercase tracking-[0.32em] text-white/50">
            NOVA
          </span>
          <span className="text-xs font-medium uppercase tracking-[0.32em] text-white/30">
            18 Pro Max
          </span>
        </nav>

        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain" />

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.15),transparent_45%)]" />

        <motion.div
          className="pointer-events-none absolute inset-0 flex items-center justify-center px-6"
          style={{ opacity: sectionOneOpacity, y: sectionOneY }}
        >
          <h1 className="max-w-3xl text-center text-4xl font-medium tracking-[-0.06em] text-white/90 sm:text-5xl md:text-7xl">
            Every detail, engineered.
          </h1>
        </motion.div>

        <motion.div
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center px-6 sm:px-12 md:px-20"
          style={{ opacity: sectionTwoOpacity, x: sectionTwoX }}
        >
          {/* Scrim so text stays legible regardless of what's behind it in the frame */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-full max-w-md bg-gradient-to-r from-black/50 via-black/20 to-transparent md:max-w-xl" />
          <p className="relative max-w-sm text-left text-xl font-medium tracking-[-0.05em] text-white/90 sm:text-2xl md:text-4xl">
            Precision in every layer.
          </p>
        </motion.div>

        <motion.div
          className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-6 sm:px-12 md:px-20"
          style={{ opacity: sectionThreeOpacity, x: sectionThreeX }}
        >
          <div className="pointer-events-none absolute inset-y-0 right-0 w-full max-w-md bg-gradient-to-l from-black/50 via-black/20 to-transparent md:max-w-xl" />
          <p className="relative max-w-sm text-right text-xl font-medium tracking-[-0.05em] text-white/90 sm:text-2xl md:text-4xl">
            See what&apos;s inside.
          </p>
        </motion.div>

        <motion.div
          className="pointer-events-none absolute inset-0 flex items-center justify-center px-6"
          style={{ opacity: sectionFourOpacity, y: sectionFourY }}
        >
          <h2 className="max-w-3xl text-center text-3xl font-medium tracking-[-0.06em] text-white/90 sm:text-5xl md:text-6xl">
            Whole again. Better than ever.
          </h2>
        </motion.div>

        <motion.div
          className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center"
          style={{ opacity: scrollHintOpacity }}
        >
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.24em] text-white/60 backdrop-blur-sm">
            <span>Scroll</span>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/80" />
          </div>
        </motion.div>
      </div>

      {!imagesLoaded && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#050505]">
          <div className="flex flex-col items-center gap-5">
            <div className="h-12 w-12 animate-spin rounded-full border border-white/15 border-t-white/80" />
            <p className="text-sm uppercase tracking-[0.28em] text-white/60">Loading</p>
            <p className="text-3xl font-medium tracking-[-0.06em] text-white/90">
              {Math.round(loadingProgress)}%
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
