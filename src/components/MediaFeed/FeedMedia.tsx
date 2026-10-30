import * as React from 'react';
import { Play } from 'lucide-react';
import { Button } from '../Button';
import {
  isInPictureInPicture,
  MediaPlayer,
  PIP_EVENTS,
  type MediaPlayerState,
} from '../MediaPlayer';
import type { MediaFeedLabels, MediaFeedMedia } from './types';

interface FeedMediaProps {
  media: MediaFeedMedia;
  title: string;
  active: boolean;
  autoPlay: boolean;
  muted: boolean;
  loop: boolean;
  labels: MediaFeedLabels;
  onActivate: () => void;
  playbackPosition: { timeMs: number; playRequested?: boolean };
  playbackRequestId?: string | number;
}

/** Only ordinary web URLs become links; media resources may use other schemes. */
function sourceHref(src: string): string | undefined {
  try {
    const url = new URL(src, 'https://localhost/');
    return ['http:', 'https:'].includes(url.protocol) ? src : undefined;
  } catch {
    return undefined;
  }
}

function SourceLink({ src, labels }: { src: string; labels: MediaFeedLabels }) {
  const href = sourceHref(src);
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary-700 dark:text-primary-300 focus-visible:ring-ring rounded underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
    >
      {labels.openSource}
    </a>
  ) : null;
}

function NativeFeedMedia({
  media,
  title,
  active,
  autoPlay,
  muted,
  loop,
  labels,
  onActivate,
  playbackPosition,
  playbackRequestId,
}: FeedMediaProps) {
  const mediaElementRef = React.useRef<
    HTMLVideoElement | HTMLAudioElement | null
  >(null);
  const [state, setState] = React.useState<MediaPlayerState>('idle');
  const [blocked, setBlocked] = React.useState(false);
  const [retryVersion, setRetryVersion] = React.useState(0);
  const wantsPlayback = React.useRef(playbackPosition.playRequested ?? false);
  const latestPlaybackRequest = React.useRef(playbackRequestId);
  latestPlaybackRequest.current = playbackRequestId;
  const handledPlaybackRequest = React.useRef<string | number | undefined>(
    undefined
  );
  const ownershipPause = React.useRef(false);
  const attemptId = React.useRef(0);
  const activeRef = React.useRef(active);
  const canSavePosition = React.useRef(false);
  activeRef.current = active;

  const tryPlay = React.useCallback(async () => {
    const element = mediaElementRef.current;
    if (!element || !activeRef.current) return;
    const attempt = ++attemptId.current;
    setBlocked(false);
    try {
      // The native promise can reject when browser autoplay policy requires a
      // gesture. Playback state still comes from native events, never intent.
      await element.play();
      // A delayed request must not start a card that has since left the active
      // surface. A newer request for the same active element can finish normally.
      if (!activeRef.current || element !== mediaElementRef.current)
        element.pause();
    } catch (error) {
      if (!activeRef.current || attempt !== attemptId.current) return;
      if (error instanceof Error && error.name === 'AbortError') return;
      setBlocked(true);
    }
  }, []);

  // A clip floating in picture in picture plays on when its item stops being
  // the one on screen (Back to the conversation, or scrolling on): the viewer
  // floated it to keep watching.
  const pauseForOwnership = React.useCallback(
    (element: HTMLMediaElement | null) => {
      if (isInPictureInPicture(element)) return;
      if (element && element === mediaElementRef.current && !element.paused)
        ownershipPause.current = true;
      element?.pause();
    },
    []
  );

  React.useEffect(() => {
    const element = mediaElementRef.current;
    const attempts = attemptId;
    const restorePosition = () => {
      if (!element || !activeRef.current) return;
      if (playbackPosition.timeMs > 0) {
        element.currentTime = playbackPosition.timeMs / 1000;
      }
      canSavePosition.current = true;
    };
    if (active && element) {
      // Another surface can clear shared manual intent while this inline copy
      // is paused (for example, the user pauses inside fullscreen).
      wantsPlayback.current = playbackPosition.playRequested ?? false;
      if (element.readyState >= 1) restorePosition();
      else element.addEventListener('loadedmetadata', restorePosition);
    }
    if (
      active &&
      (latestPlaybackRequest.current === undefined ||
        latestPlaybackRequest.current === handledPlaybackRequest.current) &&
      (autoPlay || wantsPlayback.current)
    ) {
      void tryPlay();
    } else if (!active) {
      attemptId.current++;
      pauseForOwnership(element);
      setBlocked(false);
    }
    return () => {
      attempts.current++;
      element?.removeEventListener('loadedmetadata', restorePosition);
      if (element && canSavePosition.current)
        playbackPosition.timeMs = element.currentTime * 1000;
      pauseForOwnership(element);
    };
  }, [
    active,
    autoPlay,
    pauseForOwnership,
    playbackPosition,
    retryVersion,
    tryPlay,
  ]);

  // A clip left playing in picture in picture when its item stopped being the
  // one on screen comes back with no controls (only the active item has
  // them): pause it as it lands.
  React.useEffect(() => {
    const element = mediaElementRef.current;
    if (!element) return;
    const landed = () => {
      if (!activeRef.current && !isInPictureInPicture(element)) element.pause();
    };
    for (const name of PIP_EVENTS) element.addEventListener(name, landed);
    return () => {
      for (const name of PIP_EVENTS) element.removeEventListener(name, landed);
    };
  }, [retryVersion]);

  React.useEffect(() => {
    if (
      !active ||
      playbackRequestId === undefined ||
      playbackRequestId === handledPlaybackRequest.current
    )
      return;
    handledPlaybackRequest.current = playbackRequestId;
    wantsPlayback.current = true;
    playbackPosition.playRequested = true;
    void tryPlay();
  }, [active, playbackRequestId, playbackPosition, tryPlay]);

  const togglePlayback = () => {
    if (state === 'playing') {
      wantsPlayback.current = false;
      playbackPosition.playRequested = false;
      mediaElementRef.current?.pause();
    } else {
      wantsPlayback.current = true;
      playbackPosition.playRequested = true;
      onActivate();
      if (active) void tryPlay();
    }
  };

  // Upright or sideways, the clip fills the stage at its own shape, under the
  // player's touch-first controls (a manual start when autoplay is off or
  // blocked, pause, seek, mute, full screen).
  return (
    <div className="relative flex h-full min-h-0 w-full flex-col items-center justify-center">
      <MediaPlayer
        src={media.src}
        kind={media.kind === 'audio' ? 'audio' : 'video'}
        mediaElementRef={mediaElementRef}
        muted={muted}
        loop={loop}
        poster={media.poster}
        preload={active ? 'metadata' : 'none'}
        controls={active}
        controlsStyle="overlay"
        aria-label={title}
        onStateChange={(next) => {
          setState(next);
          if (next === 'playing') {
            ownershipPause.current = false;
            // However it started — the player's own Play, a tap on the
            // picture — the viewer wants it playing: it resumes when they
            // come back to it, and a refused autoplay is no longer news.
            setBlocked(false);
            if (activeRef.current) {
              wantsPlayback.current = true;
              playbackPosition.playRequested = true;
            }
          }
          if (next === 'paused') {
            if (activeRef.current && !ownershipPause.current) {
              wantsPlayback.current = false;
              playbackPosition.playRequested = false;
            }
            ownershipPause.current = false;
          }
        }}
        onTimeUpdate={(timeMs) => {
          if (canSavePosition.current) playbackPosition.timeMs = timeMs;
        }}
        onRetry={() => {
          ownershipPause.current = false;
          canSavePosition.current = false;
          setState('idle');
          setBlocked(false);
          setRetryVersion((version) => version + 1);
        }}
        labels={{
          error: labels.mediaError,
          retry: labels.retry,
          play: labels.play,
          pause: labels.pause,
          mute: labels.mute,
          unmute: labels.unmute,
          seek: labels.seek,
          fullscreen: labels.playerFullscreen,
          exitFullscreen: labels.exitPlayerFullscreen,
          pictureInPicture: labels.pictureInPicture,
          exitPictureInPicture: labels.exitPictureInPicture,
        }}
        className="min-h-0 flex-1 [&_video]:h-full [&_video]:w-full"
      />
      {/* An item that isn't the active one has no controls yet: its ▶
          selects it and starts it. */}
      {!active && state !== 'error' && state !== 'playing' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Button
            variant="ghost"
            size="icon"
            aria-label={labels.play}
            title={labels.play}
            className="pointer-events-auto h-14 w-14 rounded-full bg-black/60 text-white hover:bg-black/75 hover:text-white focus-visible:ring-2 focus-visible:ring-white"
            onClick={togglePlayback}
          >
            <Play
              className="h-6 w-6 translate-x-0.5 fill-current"
              aria-hidden="true"
            />
          </Button>
        </div>
      )}
      {blocked && state !== 'playing' && (
        <p
          role="status"
          className="pointer-events-none absolute inset-x-0 top-3 m-0 flex justify-center px-4"
        >
          <span className="rounded bg-black/60 px-2 py-1 text-center text-sm text-white">
            {labels.blockedAutoplay}
          </span>
        </p>
      )}
      {state === 'error' && <SourceLink src={media.src} labels={labels} />}
    </div>
  );
}

function ImageFeedMedia({ media, title, labels }: FeedMediaProps) {
  const [failed, setFailed] = React.useState(false);
  return failed ? (
    <div role="alert" className="flex flex-col gap-3 p-6 text-center">
      <p className="text-muted-foreground m-0">{labels.mediaError}</p>
      <SourceLink src={media.src} labels={labels} />
    </div>
  ) : (
    <img
      src={media.src}
      alt={media.alt ?? title}
      loading="lazy"
      className="h-full max-h-full w-full object-contain"
      onError={() => setFailed(true)}
    />
  );
}

function youtubeId(src: string): string | null {
  const validId = /^[A-Za-z0-9_-]{11}$/;
  if (validId.test(src)) return src;
  try {
    const url = new URL(src);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    let id: string | null = null;
    if (host === 'youtu.be' || host === 'www.youtu.be') {
      id = parts[0] ?? null;
    } else if (
      [
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'youtube-nocookie.com',
        'www.youtube-nocookie.com',
      ].includes(host)
    ) {
      id =
        url.searchParams.get('v') ??
        (['embed', 'shorts', 'live'].includes(parts[0]) ? parts[1] : null);
    }
    return id && validId.test(id) ? id : null;
  } catch {
    return null;
  }
}

function YouTubeFeedMedia({
  media,
  title,
  active,
  autoPlay,
  muted,
  loop,
  labels,
  onActivate,
  playbackRequestId,
}: FeedMediaProps) {
  const id = youtubeId(media.src);
  const [requestedPlayback, setRequestedPlayback] = React.useState(false);
  const handledPlaybackRequest = React.useRef<string | number | undefined>(
    undefined
  );
  const pendingPlayback =
    active &&
    playbackRequestId !== undefined &&
    playbackRequestId !== handledPlaybackRequest.current;
  React.useEffect(() => {
    if (!active) setRequestedPlayback(false);
    else if (
      playbackRequestId !== undefined &&
      playbackRequestId !== handledPlaybackRequest.current
    ) {
      handledPlaybackRequest.current = playbackRequestId;
      setRequestedPlayback(true);
    }
  }, [active, playbackRequestId]);
  const embedUrl = new URL(
    `https://www.youtube-nocookie.com/embed/${id ?? ''}`
  );
  for (const [key, value] of Object.entries({
    autoplay: autoPlay || requestedPlayback || pendingPlayback ? '1' : '0',
    mute: muted ? '1' : '0',
    controls: '1',
    playsinline: '1',
    rel: '0',
    loop: loop ? '1' : '0',
    ...(loop && id ? { playlist: id } : {}),
  }))
    embedUrl.searchParams.set(key, value);
  const [failed, setFailed] = React.useState(false);
  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center gap-3">
      {active && id && !failed ? (
        <iframe
          src={embedUrl.href}
          title={title}
          className="min-h-0 w-full flex-1 border-0"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-4">
          {media.poster && (
            <img
              src={media.poster}
              alt=""
              loading="lazy"
              className="min-h-0 max-w-full flex-1 object-contain"
            />
          )}
          {id && !failed ? (
            <Button
              variant="secondary"
              leftIcon={<Play className="h-4 w-4" aria-hidden="true" />}
              onClick={() => {
                setRequestedPlayback(true);
                onActivate();
              }}
            >
              {labels.play}
            </Button>
          ) : (
            <p role="alert" className="text-muted-foreground m-0">
              {labels.mediaError}
            </p>
          )}
        </div>
      )}
      <p className="text-muted-foreground m-0 text-center text-sm">
        {labels.youtubeNotice}
      </p>
      <SourceLink
        src={id ? `https://www.youtube.com/watch?v=${id}` : media.src}
        labels={labels}
      />
    </div>
  );
}

/** Native resources share UI transport; external embeds retain their controls. */
export function FeedMedia(props: FeedMediaProps) {
  if (props.media.kind === 'image') return <ImageFeedMedia {...props} />;
  if (props.media.kind === 'youtube') return <YouTubeFeedMedia {...props} />;
  return <NativeFeedMedia {...props} />;
}
