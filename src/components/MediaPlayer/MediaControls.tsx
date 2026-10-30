import * as React from 'react';
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';

import { cn } from '../../utils/cn';
import type { UseMediaTransportReturn } from '../../hooks/useMediaTransport';
import { Slider } from '../Slider';

/** Every string the controls show or announce, for the host to localize. */
export interface MediaControlsLabels {
  play: string;
  pause: string;
  mute: string;
  unmute: string;
  seek: string;
  fullscreen: string;
  exitFullscreen: string;
}

const defaultLabels: MediaControlsLabels = {
  play: 'Play',
  pause: 'Pause',
  mute: 'Mute',
  unmute: 'Unmute',
  seek: 'Seek',
  fullscreen: 'Full screen',
  exitFullscreen: 'Exit full screen',
};

export interface MediaControlsProps {
  /** The transport attached to the `<video>` these controls drive. */
  transport: UseMediaTransportReturn;
  /**
   * The box that goes full screen with the controls (the video and these
   * controls' shared parent). Where the browser can't take an element full
   * screen (an iPhone), the video opens in the system's own player instead,
   * with AirPlay and picture in picture.
   */
  fullscreenTarget?: React.RefObject<HTMLElement | null>;
  labels?: Partial<MediaControlsLabels>;
  className?: string;
}

/** `m:ss`, or `h:mm:ss` from an hour. */
export function formatMediaTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

type WebKitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** Whether `element`'s audio is muted, following every change to it. */
function useMuted(element: HTMLMediaElement | null): boolean {
  const [muted, setMuted] = React.useState(element?.muted ?? false);
  React.useEffect(() => {
    if (!element) return;
    const update = () => setMuted(element.muted);
    update();
    element.addEventListener('volumechange', update);
    return () => element.removeEventListener('volumechange', update);
  }, [element]);
  return muted;
}

/** Whether `target` is the page's full-screen element. */
function useIsFullscreen(
  target: React.RefObject<HTMLElement | null> | undefined
): boolean {
  const [fullscreen, setFullscreen] = React.useState(false);
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const update = () =>
      setFullscreen(
        !!target?.current && document.fullscreenElement === target.current
      );
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, [target]);
  return fullscreen;
}

const barButton =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/90 hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:h-9 sm:w-9';

/**
 * Touch-first controls laid over a `<video>`, in place of the browser's own:
 * a tap on the picture plays or pauses it, a round ▶ shows while it's paused,
 * and a bar along the bottom has play/pause, the time, a seek bar, mute and
 * full screen. The same on every browser and in a mobile app's web view.
 *
 * Render it inside a positioned box together with the video, and attach
 * `transport.setMediaElement` to the video's `ref`.
 */
export function MediaControls({
  transport,
  fullscreenTarget,
  labels: labelOverrides,
  className,
}: MediaControlsProps) {
  const labels = { ...defaultLabels, ...labelOverrides };
  const video = transport.mediaElement as WebKitVideo | null;
  const muted = useMuted(video);
  const isFullscreen = useIsFullscreen(fullscreenTarget);
  const playing = transport.isPlaying;
  const durationMs = transport.durationMs;

  const togglePlay = () => {
    if (!video) return;
    // A refused start (autoplay policy) leaves it paused; the ▶ stays.
    if (video.paused) void video.play()?.catch(() => {});
    else video.pause();
  };
  const toggleMuted = () => {
    if (video) video.muted = !video.muted;
  };
  const canFullscreenBox =
    typeof document !== 'undefined' &&
    document.fullscreenEnabled &&
    !!fullscreenTarget;
  const canFullscreen = canFullscreenBox || !!video?.webkitEnterFullscreen;
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else if (canFullscreenBox && fullscreenTarget?.current) {
      void fullscreenTarget.current.requestFullscreen?.()?.catch(() => {});
    } else {
      video?.webkitEnterFullscreen?.();
    }
  };

  return (
    <div
      data-slot="media-controls"
      className={cn(
        // A container: a narrow player (a portrait card) gives the seek bar a
        // row of its own, so it's always long enough to drag.
        '@container pointer-events-none absolute inset-0 flex flex-col justify-end text-white',
        className
      )}
    >
      {/* A pointer convenience over the picture, as in every video app; the
          bar's play button is the keyboard and screen-reader control. */}
      <div
        data-slot="media-controls-surface"
        aria-hidden="true"
        className="pointer-events-auto absolute inset-0 flex cursor-pointer items-center justify-center"
        onClick={togglePlay}
      >
        {!playing && (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60">
            <Play className="h-6 w-6 translate-x-0.5 fill-current" />
          </span>
        )}
      </div>
      <div
        data-slot="media-controls-bar"
        className="pointer-events-auto relative flex flex-wrap items-center gap-x-1 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-1 pt-6 pb-1 sm:px-2"
      >
        <button
          type="button"
          className={barButton}
          aria-label={playing ? labels.pause : labels.play}
          onClick={togglePlay}
        >
          {playing ? (
            <Pause className="h-5 w-5 fill-current" aria-hidden="true" />
          ) : (
            <Play
              className="h-5 w-5 translate-x-px fill-current"
              aria-hidden="true"
            />
          )}
        </button>
        <span
          data-slot="media-controls-time"
          className="shrink-0 px-1 text-xs whitespace-nowrap tabular-nums @max-md:me-auto"
        >
          {formatMediaTime(transport.currentTimeMs)} /{' '}
          {formatMediaTime(durationMs)}
        </span>
        <Slider
          // Taller to grab on a touch screen; the track itself stays thin.
          className="mx-1 min-w-0 flex-1 @max-md:order-first @max-md:mx-2 @max-md:basis-full pointer-coarse:[&_[data-slot=slider-track-wrapper]]:py-4"
          trackClassName="bg-white/30"
          size="sm"
          min={0}
          max={durationMs > 0 ? durationMs : 1}
          step={100}
          value={transport.currentTimeMs}
          onValueChange={transport.seekToMs}
          formatValue={formatMediaTime}
          disabled={durationMs <= 0}
          aria-label={labels.seek}
        />
        <button
          type="button"
          className={barButton}
          aria-label={muted ? labels.unmute : labels.mute}
          onClick={toggleMuted}
        >
          {muted ? (
            <VolumeX className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Volume2 className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
        {canFullscreen && (
          <button
            type="button"
            className={barButton}
            aria-label={
              isFullscreen ? labels.exitFullscreen : labels.fullscreen
            }
            onClick={toggleFullscreen}
          >
            {isFullscreen ? (
              <Minimize className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Maximize className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
