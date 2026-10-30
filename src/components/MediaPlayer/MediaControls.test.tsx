import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatMediaTime } from './MediaControls';
import { MediaPlayer } from './MediaPlayer';

/** jsdom has no playback: play/pause flip `paused` and fire their events. */
function mockPlayback() {
  const paused = new WeakMap<HTMLMediaElement, boolean>();
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(
    function (this: HTMLMediaElement) {
      return paused.get(this) ?? true;
    }
  );
  const play = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockImplementation(function (this: HTMLMediaElement) {
      paused.set(this, false);
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement
  ) {
    paused.set(this, true);
    this.dispatchEvent(new Event('pause'));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  return play;
}

/** A video whose metadata says it runs `seconds`. */
function loadMetadata(video: HTMLVideoElement, seconds: number) {
  Object.defineProperty(video, 'duration', {
    configurable: true,
    value: seconds,
  });
  act(() => {
    video.dispatchEvent(new Event('loadedmetadata'));
  });
}

const renderOverlay = () => {
  const view = render(
    <MediaPlayer src="clip.mp4" controlsStyle="overlay" aria-label="Clip" />
  );
  const video = view.container.querySelector('video') as HTMLVideoElement;
  return { ...view, video };
};

beforeEach(() => {
  mockPlayback();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatMediaTime', () => {
  it('reads as minutes and seconds, with hours from an hour', () => {
    expect(formatMediaTime(0)).toBe('0:00');
    expect(formatMediaTime(4_200)).toBe('0:04');
    expect(formatMediaTime(83_000)).toBe('1:23');
    expect(formatMediaTime(3_723_000)).toBe('1:02:03');
  });
});

describe('MediaPlayer overlay controls', () => {
  it("replace the browser's own controls on a video", () => {
    const { video, container } = renderOverlay();
    expect(video.controls).toBe(false);
    expect(
      container.querySelector('[data-slot="media-controls"]')
    ).not.toBeNull();
  });

  it('keeps the browser controls by default, and on audio', () => {
    const { container, rerender } = render(<MediaPlayer src="clip.mp4" />);
    expect(container.querySelector('video')?.controls).toBe(true);
    rerender(<MediaPlayer src="song.mp3" controlsStyle="overlay" />);
    expect(container.querySelector('audio')?.controls).toBe(true);
    expect(container.querySelector('[data-slot="media-controls"]')).toBeNull();
  });

  it('plays and pauses from the bar or a tap on the picture', () => {
    const { video, container } = renderOverlay();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(video.paused).toBe(false);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    fireEvent.click(
      container.querySelector('[data-slot="media-controls-surface"]')!
    );
    expect(video.paused).toBe(true);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('shows the time and seeks from the bar, with the time read out', () => {
    const { video } = renderOverlay();
    loadMetadata(video, 83);
    const seek = screen.getByRole('slider', { name: 'Seek' });
    expect(seek).toHaveAttribute('aria-valuetext', '0:00');
    expect(screen.getByText('0:00 / 1:23')).toBeInTheDocument();
    fireEvent.keyDown(seek, { key: 'End' });
    expect(video.currentTime).toBe(83);
    expect(seek).toHaveAttribute('aria-valuetext', '1:23');
  });

  it('mutes and unmutes', () => {
    const { video } = renderOverlay();
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(video.muted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    expect(video.muted).toBe(false);
  });

  it("takes the player's box full screen where the browser can", () => {
    Object.defineProperty(document, 'fullscreenEnabled', {
      configurable: true,
      value: true,
    });
    const requestFullscreen = vi.fn(() => Promise.resolve());
    HTMLElement.prototype.requestFullscreen = requestFullscreen;
    const { container } = renderOverlay();
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(requestFullscreen.mock.contexts[0]).toBe(
      container.querySelector('[data-slot="media-player-box"]')
    );
    Object.defineProperty(document, 'fullscreenEnabled', {
      configurable: true,
      value: false,
    });
  });

  it('opens the system player where only the video can go full screen (an iPhone)', () => {
    Object.defineProperty(document, 'fullscreenEnabled', {
      configurable: true,
      value: false,
    });
    const enter = vi.fn();
    (
      HTMLVideoElement.prototype as HTMLVideoElement & {
        webkitEnterFullscreen?: () => void;
      }
    ).webkitEnterFullscreen = enter;
    renderOverlay();
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(enter).toHaveBeenCalledOnce();
    delete (
      HTMLVideoElement.prototype as HTMLVideoElement & {
        webkitEnterFullscreen?: () => void;
      }
    ).webkitEnterFullscreen;
  });

  describe('picture in picture', () => {
    const setPipSupport = (enabled: boolean) =>
      Object.defineProperty(document, 'pictureInPictureEnabled', {
        configurable: true,
        value: enabled,
      });
    const setPipElement = (element: Element | null) =>
      Object.defineProperty(document, 'pictureInPictureElement', {
        configurable: true,
        value: element,
      });
    afterEach(() => {
      setPipSupport(false);
      setPipElement(null);
      delete (
        HTMLVideoElement.prototype as { requestPictureInPicture?: unknown }
      ).requestPictureInPicture;
      delete (
        HTMLVideoElement.prototype as {
          webkitSupportsPresentationMode?: unknown;
        }
      ).webkitSupportsPresentationMode;
    });

    it('offers no button where the browser has none', () => {
      setPipSupport(false);
      renderOverlay();
      expect(
        screen.queryByRole('button', { name: 'Picture in picture' })
      ).toBeNull();
    });

    it('floats the video, and says so once it floats', () => {
      setPipSupport(true);
      const request = vi.fn(() =>
        Promise.resolve({} as PictureInPictureWindow)
      );
      HTMLVideoElement.prototype.requestPictureInPicture = request;
      const { video } = renderOverlay();
      fireEvent.click(
        screen.getByRole('button', { name: 'Picture in picture' })
      );
      expect(request).toHaveBeenCalledOnce();
      expect(request.mock.contexts[0]).toBe(video);
      setPipElement(video);
      act(() => {
        video.dispatchEvent(new Event('enterpictureinpicture'));
      });
      expect(
        screen.getByRole('button', { name: 'Exit picture in picture' })
      ).toBeInTheDocument();
    });

    it("uses Safari's own mode on an iPhone", () => {
      setPipSupport(false);
      const proto = HTMLVideoElement.prototype as HTMLVideoElement & {
        webkitSupportsPresentationMode?: (mode: string) => boolean;
        webkitSetPresentationMode?: (mode: string) => void;
      };
      proto.webkitSupportsPresentationMode = () => true;
      const setMode = vi.fn();
      proto.webkitSetPresentationMode = setMode;
      renderOverlay();
      fireEvent.click(
        screen.getByRole('button', { name: 'Picture in picture' })
      );
      expect(setMode).toHaveBeenCalledWith('picture-in-picture');
      delete proto.webkitSetPresentationMode;
    });
  });

  it('localizes every label', () => {
    render(
      <MediaPlayer
        src="clip.mp4"
        controlsStyle="overlay"
        labels={{ play: 'Lecture', mute: 'Couper le son', seek: 'Position' }}
      />
    );
    expect(screen.getByRole('button', { name: 'Lecture' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Couper le son' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('slider', { name: 'Position' })
    ).toBeInTheDocument();
  });
});
