import * as React from 'react';
import { ChevronDown, ChevronUp, Maximize2 } from 'lucide-react';
import { cn } from '../../utils/cn';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { Modal, ModalClose, ModalHeader, ModalTitle } from '../Modal';
import { FeedMedia } from './FeedMedia';
import type { MediaFeedLabels, MediaFeedProps } from './types';

const defaultLabels: MediaFeedLabels = {
  feed: 'Media feed',
  loading: 'Loading media…',
  empty: 'No media to display.',
  error: 'Unable to load the media feed.',
  retry: 'Retry',
  fullscreen: 'Open fullscreen',
  close: 'Close fullscreen',
  previous: 'Previous item',
  next: 'Next item',
  play: 'Play',
  pause: 'Pause',
  mute: 'Mute',
  unmute: 'Unmute',
  seek: 'Seek',
  playerFullscreen: 'Full screen',
  exitPlayerFullscreen: 'Exit full screen',
  pictureInPicture: 'Picture in picture',
  exitPictureInPicture: 'Exit picture in picture',
  blockedAutoplay: 'Playback did not start. Press Play to try again.',
  mediaError: 'This media is unavailable.',
  openSource: 'Open source',
  youtubeNotice: 'If embedded playback is unavailable, open the source.',
  item: (position, total) => `Media item ${position} of ${total}`,
  position: (position, total) => `${position} / ${total}`,
};

/**
 * The post's words under its title: two lines over the picture, and a tap
 * shows the rest when they don't fit. Plain text only becomes a toggle; other
 * content (it may hold its own links) stays clamped.
 */
function FeedCaption({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [overflows, setOverflows] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  // Measured again whenever its box changes — a phone turned, the window
  // resized, fonts arriving, the feed shown after being hidden — since that
  // decides whether two lines are enough.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children, expanded, overflows]);
  const classes = cn(
    'm-0 block w-full text-start text-xs break-words text-white/80',
    expanded ? 'max-h-32 overflow-y-auto' : 'line-clamp-2',
    className
  );
  return typeof children === 'string' && (overflows || expanded) ? (
    <button
      ref={(node) => {
        ref.current = node;
      }}
      type="button"
      data-slot="caption"
      aria-expanded={expanded}
      onClick={() => setExpanded((open) => !open)}
      className={cn('pointer-events-auto cursor-pointer', classes)}
    >
      {children}
    </button>
  ) : (
    <p
      ref={(node) => {
        ref.current = node;
      }}
      data-slot="caption"
      className={classes}
    >
      {children}
    </p>
  );
}

/** Previous/Next over the feed's edge: round, thumb-sized on a touch screen. */
const NAV_BUTTON_CLASS =
  'h-10 w-10 rounded-full bg-black/45 p-0 text-white/90 backdrop-blur-sm hover:bg-black/65 hover:text-white disabled:opacity-30 pointer-fine:h-9 pointer-fine:w-9';

/**
 * A vertical, caller-owned media collection with one active playback surface.
 * Native players share MediaPlayer; provider-specific players can use the
 * renderMedia slot. Records, engagement actions and navigation belong to the host.
 */
function MediaFeedInner<T>(
  {
    items,
    getId,
    getMedia,
    getTitle,
    getCaption,
    getAuthor,
    renderActions,
    renderMedia,
    allowFullscreen = true,
    activeItemId,
    defaultActiveItemId,
    onActiveItemChange,
    playbackRequest,
    loading = false,
    error,
    onRetry,
    autoPlay = true,
    muted = true,
    loop = true,
    labels: labelOverrides,
    classNames = {},
    className,
    ...rest
  }: MediaFeedProps<T>,
  forwardedRef: React.ForwardedRef<HTMLDivElement>
) {
  const labels = { ...defaultLabels, ...labelOverrides };
  const prefersReducedMotion = usePrefersReducedMotion();
  const allowAutoPlay = autoPlay && !prefersReducedMotion;
  const ids = items.map(getId);
  const idsKey = JSON.stringify(ids);
  const [internalActiveId, setInternalActiveId] = React.useState(
    () => defaultActiveItemId ?? ids[0]
  );
  const requestedId = activeItemId ?? internalActiveId;
  const activeId =
    requestedId !== undefined && ids.includes(requestedId)
      ? requestedId
      : ids[0];
  const activeIndex = activeId === undefined ? -1 : ids.indexOf(activeId);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);
  const [retryFailed, setRetryFailed] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const cardRefs = React.useRef(new Map<string, HTMLElement>());
  const playbackPositions = React.useRef(
    new Map<string, { src: string; timeMs: number; playRequested?: boolean }>()
  );
  const consumedPlaybackRequests = React.useRef(
    new Map<string, string | number>()
  );
  const fullscreenTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const hasObserver = typeof IntersectionObserver !== 'undefined';
  // Hydration safety: the server cannot know whether the client supports
  // IntersectionObserver, so both environments start "not visible" and the
  // mount effects below establish real visibility (observer callbacks, or the
  // no-observer fallback). Offscreen autoplay therefore never starts early.
  const [visibleId, setVisibleId] = React.useState<string | null>(null);
  const visibleIdRef = React.useRef(visibleId);
  const [viewportVisible, setViewportVisible] = React.useState(false);
  const [pageVisible, setPageVisible] = React.useState(
    () =>
      typeof document === 'undefined' || document.visibilityState !== 'hidden'
  );
  const latest = React.useRef({
    items,
    ids,
    activeId,
    activeItemId,
    onActiveItemChange,
    fullscreen,
  });
  latest.current = {
    items,
    ids,
    activeId,
    activeItemId,
    onActiveItemChange,
    fullscreen,
  };

  const setRoot = React.useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef]
  );

  const select = React.useCallback((id: string) => {
    const current = latest.current;
    const index = current.ids.indexOf(id);
    if (index < 0 || id === current.activeId) return;
    if (current.activeItemId === undefined) setInternalActiveId(id);
    current.onActiveItemChange?.(current.items[index]);
  }, []);

  // Visibility belongs to this feed, never a global keyboard/player singleton.
  // A separate viewport observer also pauses a feed scrolled off the host page.
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      // No-observer fallback: assume the feed is on screen.
      setViewportVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setViewportVisible(entry.isIntersecting);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof IntersectionObserver === 'undefined') return;
    const ratios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.mediaId;
          if (id !== undefined)
            ratios.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestId = id;
            bestRatio = ratio;
          }
        }
        visibleIdRef.current = bestId;
        setVisibleId(bestId);
        if (bestId !== null && !latest.current.fullscreen) select(bestId);
      },
      { root: viewport, threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    cardRefs.current.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [idsKey, loading, error, select]);

  React.useEffect(() => {
    const update = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  // Controlled selection and initial deep links scroll within the feed, without
  // moving the surrounding inbox/page. Observer selections are already visible.
  React.useEffect(() => {
    if (activeId === undefined) return;
    if (!hasObserver) {
      visibleIdRef.current = activeId;
      setVisibleId(activeId);
    }
    if (visibleIdRef.current === activeId && hasObserver) return;
    const card = cardRefs.current.get(activeId);
    if (card && viewportRef.current) {
      viewportRef.current.scrollTo?.({ top: card.offsetTop, behavior: 'auto' });
    }
  }, [activeId, idsKey, hasObserver, loading, error]);

  React.useEffect(() => {
    if (!items.length) setFullscreen(false);
  }, [items.length]);

  // The gesture targets an already selected, visible surface. Consume it once
  // per feed so a later source/fullscreen remount cannot resurrect a paused clip.
  React.useEffect(() => {
    if (
      loading ||
      error ||
      activeIndex < 0 ||
      !playbackRequest ||
      playbackRequest.itemId !== activeId
    )
      return;
    if (
      !pageVisible ||
      (!fullscreen && (!viewportVisible || visibleId !== activeId))
    )
      return;
    consumedPlaybackRequests.current.set(
      playbackRequest.itemId,
      playbackRequest.requestId
    );
  }, [
    activeId,
    activeIndex,
    fullscreen,
    pageVisible,
    viewportVisible,
    visibleId,
    playbackRequest,
    loading,
    error,
  ]);

  React.useEffect(() => {
    const positions = playbackPositions.current;
    for (const id of positions.keys()) {
      if (!latest.current.ids.includes(id)) positions.delete(id);
    }
  }, [idsKey]);

  React.useEffect(() => {
    if (fullscreen || !fullscreenTriggerRef.current) return;
    if (fullscreenTriggerRef.current.isConnected)
      fullscreenTriggerRef.current.focus();
    else viewportRef.current?.focus();
    fullscreenTriggerRef.current = null;
  }, [fullscreen]);

  const navigate = (index: number, focus = false) => {
    const id = ids[Math.max(0, Math.min(index, ids.length - 1))];
    if (id === undefined) return;
    select(id);
    const card = cardRefs.current.get(id);
    if (card && viewportRef.current) {
      viewportRef.current.scrollTo?.({ top: card.offsetTop, behavior: 'auto' });
      if (focus) card.focus({ preventScroll: true });
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Never steal arrows/Space from a player, reaction button or chat composer.
    const target = event.target as HTMLElement;
    if (event.target !== event.currentTarget && target.dataset?.slot !== 'item')
      return;
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
      case 'PageDown':
        next = activeIndex + 1;
        break;
      case 'ArrowUp':
      case 'PageUp':
        next = activeIndex - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    navigate(next, event.target !== event.currentTarget);
  };

  const retry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    setRetryFailed(false);
    try {
      await onRetry();
    } catch {
      setRetryFailed(true);
    } finally {
      setRetrying(false);
    }
  };

  const renderCard = (item: T, index: number, immersive: boolean) => {
    const id = getId(item);
    const media = getMedia(item);
    let playbackPosition = playbackPositions.current.get(id);
    if (!playbackPosition || playbackPosition.src !== media.src) {
      playbackPosition = { src: media.src, timeMs: 0 };
      playbackPositions.current.set(id, playbackPosition);
    }
    // The position names an untitled item for assistive tech; on screen the
    // counter already says it, so only a real title is shown.
    const ownTitle = getTitle?.(item);
    const title = ownTitle || labels.item(index + 1, items.length);
    const author = getAuthor?.(item);
    const caption = getCaption?.(item);
    // Only words that add something: not empty, not the title over again.
    const showCaption =
      caption != null &&
      caption !== '' &&
      !(
        typeof caption === 'string' &&
        caption.trim() === (ownTitle ?? '').trim()
      );
    const active =
      !loading &&
      !error &&
      pageVisible &&
      (immersive
        ? fullscreen && id === activeId
        : !fullscreen &&
          viewportVisible &&
          id === activeId &&
          id === visibleId);
    const playbackRequestId =
      active &&
      playbackRequest?.itemId === id &&
      consumedPlaybackRequests.current.get(id) !== playbackRequest.requestId
        ? playbackRequest.requestId
        : undefined;
    return (
      <article
        key={id}
        ref={
          immersive
            ? undefined
            : (node) => {
                if (node) cardRefs.current.set(id, node);
                else cardRefs.current.delete(id);
              }
        }
        data-slot="item"
        data-media-id={id}
        data-active={active}
        aria-label={title}
        aria-posinset={index + 1}
        aria-setsize={items.length}
        tabIndex={id === activeId ? 0 : -1}
        // The clip is the whole item: it fills a dark stage (dark in every
        // theme, as video surfaces are) at its own shape, upright or
        // sideways, and who posted it and what they said float over its top on
        // a gradient, clear of the player's controls along the bottom. Focus
        // is an outline, drawn over the stage.
        className={cn(
          'relative h-full min-h-0 w-full snap-start snap-always overflow-hidden bg-black text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/70',
          immersive ? 'flex-1' : 'shrink-0',
          classNames.item
        )}
      >
        <div
          data-slot="media"
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-black',
            classNames.media
          )}
        >
          {renderMedia ? (
            renderMedia(media, {
              item,
              active,
              autoPlay: allowAutoPlay,
              muted,
              loop,
              playbackRequestId,
            })
          ) : (
            <FeedMedia
              key={`${id}:${media.kind}:${media.src}:${immersive}`}
              media={media}
              title={title}
              active={active}
              autoPlay={allowAutoPlay}
              muted={muted}
              loop={loop}
              labels={labels}
              onActivate={() => select(id)}
              playbackPosition={playbackPosition}
              playbackRequestId={playbackRequestId}
            />
          )}
        </div>
        {/* Over the picture, but only its own controls take a tap: the rest
            of a tap lands on the player beneath (play/pause). */}
        <div
          data-slot="details"
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 bg-gradient-to-b from-black/75 via-black/40 to-transparent px-3 pt-2 pb-10 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]',
            classNames.details
          )}
        >
          {author && (
            <Avatar
              name={author.name}
              src={author.avatar}
              alt=""
              size="xs"
              className="mt-0.5 shrink-0"
            />
          )}
          <div className="min-w-0 flex-1 leading-5">
            {author && (
              <p
                data-slot="author"
                className={cn(
                  'm-0 truncate text-xs font-medium text-white/85',
                  classNames.author
                )}
              >
                {author.name}
              </p>
            )}
            {ownTitle && (
              <h3
                data-slot="title"
                className={cn(
                  'm-0 truncate text-sm font-semibold',
                  classNames.title
                )}
              >
                {ownTitle}
              </h3>
            )}
            {showCaption && (
              <FeedCaption className={classNames.caption}>
                {caption}
              </FeedCaption>
            )}
          </div>
          {(renderActions || (allowFullscreen && !immersive)) && (
            <div className="pointer-events-auto -me-1 -mt-1 flex shrink-0 items-center gap-1">
              {renderActions && (
                <div
                  data-slot="actions"
                  className={cn(
                    'flex flex-wrap items-center justify-end gap-2',
                    classNames.actions
                  )}
                >
                  {renderActions(item)}
                </div>
              )}
              {allowFullscreen && !immersive && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-white/85 hover:bg-white/10 hover:text-white"
                  aria-label={labels.fullscreen}
                  title={labels.fullscreen}
                  onClick={(event) => {
                    fullscreenTriggerRef.current = event.currentTarget;
                    select(id);
                    setFullscreen(true);
                  }}
                >
                  <Maximize2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          )}
        </div>
      </article>
    );
  };

  // Over the feed's end edge, stacked as the feed scrolls (swiping is the
  // other way through), clear of the details along the top and the player's
  // controls along the bottom.
  const controls = (
    <div
      data-slot="controls"
      className={cn(
        'pointer-events-none absolute end-2 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1.5',
        classNames.controls
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label={labels.previous}
        title={labels.previous}
        className={cn('pointer-events-auto', NAV_BUTTON_CLASS)}
        disabled={activeIndex <= 0}
        onClick={() => navigate(activeIndex - 1)}
      >
        <ChevronUp className="h-5 w-5" aria-hidden="true" />
      </Button>
      <span
        role="status"
        aria-live="polite"
        className="rounded-full bg-black/45 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white/85 tabular-nums backdrop-blur-sm"
      >
        {labels.position(activeIndex + 1, items.length)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label={labels.next}
        title={labels.next}
        className={cn('pointer-events-auto', NAV_BUTTON_CLASS)}
        disabled={activeIndex >= items.length - 1}
        onClick={() => navigate(activeIndex + 1)}
      >
        <ChevronDown className="h-5 w-5" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <div
      ref={setRoot}
      data-slot="root"
      data-component="media-feed"
      className={cn(
        'relative flex h-[min(48rem,80dvh)] min-h-0 w-full flex-col bg-black text-white',
        classNames.root,
        className
      )}
      {...rest}
    >
      {loading || error || !items.length ? (
        <div
          data-slot="status"
          role={error ? 'alert' : 'status'}
          aria-busy={loading || retrying}
          className={cn(
            'flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center',
            classNames.status
          )}
        >
          <p className="m-0">
            {loading ? labels.loading : error || labels.empty}
          </p>
          {error && onRetry && (
            <Button
              variant="outline"
              isLoading={retrying}
              loadingText={labels.loading}
              onClick={() => {
                void retry();
              }}
            >
              {labels.retry}
            </Button>
          )}
          {retryFailed && (
            <p role="alert" className="m-0">
              {labels.error}
            </p>
          )}
        </div>
      ) : (
        <>
          {/* ARIA feeds are focusable composites with scoped item navigation. */}
          {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
          <div
            ref={viewportRef}
            data-slot="viewport"
            role="feed"
            aria-label={labels.feed}
            aria-busy={false}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className={cn(
              'focus-visible:ring-ring relative flex min-h-0 flex-1 snap-y snap-mandatory flex-col overflow-y-auto overscroll-contain bg-black focus-visible:ring-2 focus-visible:outline-none',
              classNames.viewport
            )}
          >
            {items.map((item, index) => renderCard(item, index, false))}
          </div>
          {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
          {controls}
        </>
      )}
      <Modal
        open={
          allowFullscreen && fullscreen && !loading && !error && !!items.length
        }
        onOpenChange={setFullscreen}
        size="full"
        className="h-dvh min-h-0 sm:h-[calc(100dvh-2rem)]"
      >
        <ModalHeader>
          <ModalTitle>{labels.feed}</ModalTitle>
          <ModalClose aria-label={labels.close} />
        </ModalHeader>
        {/* Fullscreen keeps the same feed navigation; controls retain their keys. */}
        {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <div
          data-slot="fullscreen"
          data-component="media-feed"
          role="feed"
          aria-label={labels.feed}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className={cn(
            'relative flex min-h-0 flex-1 flex-col px-2 pb-2 sm:px-4',
            classNames.fullscreen
          )}
        >
          {activeIndex >= 0 &&
            renderCard(items[activeIndex], activeIndex, true)}
          {controls}
        </div>
        {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      </Modal>
    </div>
  );
}

export const MediaFeed = React.forwardRef(MediaFeedInner) as <T>(
  props: MediaFeedProps<T> & React.RefAttributes<HTMLDivElement>
) => React.ReactElement;

(MediaFeed as React.NamedExoticComponent).displayName = 'MediaFeed';
