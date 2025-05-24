import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import ChartListItem from './ChartListItem.svelte';
import { formatLevelDisplay } from '$lib/utils';

// Mock svelte-i18n
vi.mock('svelte-i18n', () => ({
  _: (key: string) => key,
}));

describe('Basic Rendering', () => {
  it('should render basic chart information', () => {
    const item = {
      display_id: '001',
      title: 'Test Song',
      artist: 'Test Artist',
      bpm: 120,
      dtx_files: { guitar: { level: 1.23 }, bass: { level: 4.56 }, drums: { level: 7.89 } }, // Adjusted to match expected structure for formatLevelDisplay
      preview_url: null,
      is_published: false,
      // Add other properties of Chart that might be accessed, with default/mock values
      id: 'test-id',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      user_id: 'test-user-id',
      description: 'Test description',
      play_count: 0,
      tags: [],
      game_version: null,
      song_length: null,
      video_url: null,
      download_url: null,
      is_metadata_only: false,
      parent_chart_id: null,
      metadata: {},
    };

    const mockTogglePublishChart = vi.fn();
    const mockGetPreviewUrl = vi.fn();
    const mockGetSoundPreviewUrl = vi.fn();
    const mockOnFileDelete = vi.fn();

    render(ChartListItem, {
      props: {
        item,
        isBlog: false,
        togglePublishChart: mockTogglePublishChart,
        getPreviewUrl: mockGetPreviewUrl,
        getSoundPreviewUrl: mockGetSoundPreviewUrl,
        onFileDelete: mockOnFileDelete,
      },
    });

    // Assert title (including display_id)
    expect(screen.getByText('001. Test Song')).toBeInTheDocument();

    // Assert artist
    expect(screen.getByText('Test Artist')).toBeInTheDocument();

    // Assert BPM
    expect(screen.getByText('BPM: 120')).toBeInTheDocument();

    // Assert level display
    // The formatLevelDisplay function will produce something like "G:1.23 B:4.56 D:7.89"
    // The component prepends 'blog.level: ' to this.
    const expectedLevelDisplay = `blog.level: ${formatLevelDisplay(item.dtx_files)}`;
    expect(screen.getByText(expectedLevelDisplay)).toBeInTheDocument();
  });
});

describe('Preview Handling', () => {
  const baseItem = {
    display_id: '002',
    title: 'Preview Test Song',
    artist: 'Preview Artist',
    bpm: 150,
    dtx_files: { guitar: { level: 2.34 } },
    is_published: true,
    id: 'preview-test-id',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    user_id: 'preview-user-id',
    description: 'Preview description',
    play_count: 10,
    tags: ['preview'],
    game_version: null,
    song_length: null,
    video_url: null,
    download_url: null,
    is_metadata_only: false,
    parent_chart_id: null,
    metadata: {},
  };

  const mockTogglePublishChart = vi.fn();
  const mockOnFileDelete = vi.fn();

  it('should render ImageAudio when preview_url is present and call preview URL functions', () => {
    const mockGetPreviewUrl = vi.fn((url) => `mocked_preview_${url}`);
    const mockGetSoundPreviewUrl = vi.fn((url) => (url ? `mocked_sound_${url}` : null));

    const itemWithPreview = {
      ...baseItem,
      preview_url: 'some_image.jpg',
      sound_preview_url: 'some_sound.mp3',
    };

    render(ChartListItem, {
      props: {
        item: itemWithPreview,
        isBlog: false,
        togglePublishChart: mockTogglePublishChart,
        getPreviewUrl: mockGetPreviewUrl,
        getSoundPreviewUrl: mockGetSoundPreviewUrl,
        onFileDelete: mockOnFileDelete,
      },
    });

    expect(mockGetPreviewUrl).toHaveBeenCalledWith('some_image.jpg');
    expect(mockGetSoundPreviewUrl).toHaveBeenCalledWith('some_sound.mp3');
    expect(screen.queryByText('No preview available')).toBeNull();
    // We can't directly check for ImageAudio component easily without deeper mocking or specific selectors.
    // However, we can check for elements that ImageAudio *would* render if it were present.
    // For example, if ImageAudio renders an img with a src attribute based on its prop:
    // const imgElement = screen.getByRole('img'); // This might be too generic
    // expect(imgElement).toHaveAttribute('src', 'mocked_preview_some_image.jpg');
    // For now, queryByText for "No preview available" being null is a good indicator.
  });

  it("should display 'No preview available' when preview_url is null", () => {
    const mockGetPreviewUrl = vi.fn((url) => `mocked_preview_${url}`);
    const mockGetSoundPreviewUrl = vi.fn((url) => (url ? `mocked_sound_${url}` : null));

    const itemWithoutPreview = {
      ...baseItem,
      preview_url: null,
      sound_preview_url: null,
    };

    render(ChartListItem, {
      props: {
        item: itemWithoutPreview,
        isBlog: false,
        togglePublishChart: mockTogglePublishChart,
        getPreviewUrl: mockGetPreviewUrl,
        getSoundPreviewUrl: mockGetSoundPreviewUrl,
        onFileDelete: mockOnFileDelete,
      },
    });

    expect(screen.getByText('No preview available')).toBeInTheDocument();
    // Depending on ChartListItem's internal logic, these might be called with null or not at all.
    // If they are called with null, the following is more accurate:
    expect(mockGetPreviewUrl).toHaveBeenCalledWith(null);
    expect(mockGetSoundPreviewUrl).toHaveBeenCalledWith(null);
    // If they are truly not called when the initial URL is null, then:
    // expect(mockGetPreviewUrl).not.toHaveBeenCalled();
    // expect(mockGetSoundPreviewUrl).not.toHaveBeenCalled();
    // Based on typical Svelte prop handling, they'd likely be called with the null value.
  });
});

describe('Admin Mode (isBlog=false)', () => {
  const mockTogglePublishChart = vi.fn();
  const mockOnFileDelete = vi.fn();
  const mockGetPreviewUrl = vi.fn((url) => url); // Simple pass-through for testing
  const mockGetSoundPreviewUrl = vi.fn((url) => url); // Simple pass-through for testing

  const baseAdminItem = {
    display_id: '003',
    title: 'Admin Test Song',
    artist: 'Admin Artist',
    bpm: 180,
    dtx_files: { drums: { level: 9.99 } },
    is_published: false,
    id: 123, // Using a number as per original spec, ensure component handles it.
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    user_id: 'admin-user-id',
    description: 'Admin description',
    play_count: 100,
    tags: ['admin'],
    game_version: null,
    song_length: null,
    video_url: null,
    download_url: null,
    is_metadata_only: false,
    parent_chart_id: null,
    metadata: {},
    preview_url: 'prev.jpg',
    sound_preview_url: 'sound.mp3',
  };

  // Helper function to render the component for admin tests
  const renderAdminItem = (itemProps = {}) => {
    const item = { ...baseAdminItem, ...itemProps };
    return render(ChartListItem, {
      props: {
        item,
        isBlog: false,
        togglePublishChart: mockTogglePublishChart,
        getPreviewUrl: mockGetPreviewUrl,
        getSoundPreviewUrl: mockGetSoundPreviewUrl,
        onFileDelete: mockOnFileDelete,
      },
    });
  };

  beforeEach(() => {
    // Reset mocks before each test
    mockTogglePublishChart.mockClear();
    mockOnFileDelete.mockClear();
    mockGetPreviewUrl.mockClear();
    mockGetSoundPreviewUrl.mockClear();
  });

  it('should display ellipsis menu, and Edit link should be correct', async () => {
    renderAdminItem({ id: 123 });

    // Find the ellipsis button - assuming it's the only button without explicit text initially
    // Or use a more specific selector if available, e.g., data-testid
    const ellipsisButton = screen.getByRole('button', { name: /ellipses-vertical/i }); // Lucide icons might have a title or aria-label
    expect(ellipsisButton).toBeInTheDocument();

    await fireEvent.click(ellipsisButton);

    // Popover content is often in document.body
    const editLink = await screen.findByText('admin.edit');
    expect(editLink).toBeInTheDocument();
    expect(editLink.closest('a')).toHaveAttribute('href', '/app/chart/123');
  });

  it('should handle Publish/Unpublish button correctly', async () => {
    let item = { ...baseAdminItem, id: 123, is_published: false };
    const { rerender } = renderAdminItem(item);

    const ellipsisButton = screen.getByRole('button', { name: /ellipses-vertical/i });
    await fireEvent.click(ellipsisButton);

    const publishButton = await screen.findByText('admin.publish');
    expect(publishButton).toBeInTheDocument();
    await fireEvent.click(publishButton);
    expect(mockTogglePublishChart).toHaveBeenCalledWith(123, false);

    // Simulate item being published
    item = { ...item, is_published: true };
    // Need to ensure Popover is closed before re-finding ellipsis for rerender
    // In a real app, clicking publish might close the popover. Here we manually ensure clean state.
    // Or, if popover remains open, we don't need to click ellipsis again.
    // For robustness, let's assume it closes or we re-render fully.
    rerender({
        item,
        isBlog: false,
        togglePublishChart: mockTogglePublishChart,
        getPreviewUrl: mockGetPreviewUrl,
        getSoundPreviewUrl: mockGetSoundPreviewUrl,
        onFileDelete: mockOnFileDelete,
     });
    
    const newEllipsisButton = screen.getByRole('button', { name: /ellipses-vertical/i });
    await fireEvent.click(newEllipsisButton); // Re-open popover

    const unpublishButton = await screen.findByText('admin.unpublish');
    expect(unpublishButton).toBeInTheDocument();
    await fireEvent.click(unpublishButton);
    expect(mockTogglePublishChart).toHaveBeenCalledWith(123, true);
  });

  it('should handle Delete button and modal interaction', async () => {
    renderAdminItem({ id: 123, preview_url: 'prev.jpg', sound_preview_url: 'sound.mp3' });

    const ellipsisButton = screen.getByRole('button', { name: /ellipses-vertical/i });
    await fireEvent.click(ellipsisButton);

    const deleteButtonInMenu = await screen.findByText('admin.delete');
    expect(deleteButtonInMenu).toBeInTheDocument();
    await fireEvent.click(deleteButtonInMenu);

    // Modal opens - use text that's likely to be unique to the modal
    expect(await screen.findByText('admin.delete_chart_confirm_title')).toBeInTheDocument();
    expect(await screen.findByText('admin.delete_chart_confirm_message')).toBeInTheDocument();

    const cancelButton = await screen.findByText('globals.cancel');
    expect(cancelButton).toBeInTheDocument();
    await fireEvent.click(cancelButton);

    // Assert modal closes
    expect(screen.queryByText('admin.delete_chart_confirm_title')).toBeNull();

    // Re-open the modal
    // Ellipsis might need to be re-clicked if popover closed
    // Check if popover is still open or find ellipsis again
    // Assuming popover closed after modal interaction
    const newEllipsisButton = screen.getByRole('button', { name: /ellipses-vertical/i });
    await fireEvent.click(newEllipsisButton);
    const newDeleteButtonInMenu = await screen.findByText('admin.delete');
    await fireEvent.click(newDeleteButtonInMenu);

    expect(await screen.findByText('admin.delete_chart_confirm_title')).toBeInTheDocument(); // Modal is back

    const confirmButton = await screen.findByText('globals.delete');
    expect(confirmButton).toBeInTheDocument();
    await fireEvent.click(confirmButton);

    expect(mockOnFileDelete).toHaveBeenCalledWith(123, 'prev.jpg', 'sound.mp3');

    // Assert modal closes after confirm
    expect(screen.queryByText('admin.delete_chart_confirm_title')).toBeNull();
  });
});

describe('Blog Mode (isBlog=true)', () => {
  const mockGetPreviewUrl = vi.fn((url) => url);
  const mockGetSoundPreviewUrl = vi.fn((url) => url);

  const baseBlogItem = {
    display_id: '004',
    title: 'Blog Test Song',
    artist: 'Blog Artist',
    bpm: 100,
    dtx_files: { guitar: { level: 5.55 } },
    is_published: true, // Typically true for blog items
    id: 'blog-item-456',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    user_id: 'blog-user-id',
    description: 'Blog description',
    play_count: 1000,
    tags: ['blog'],
    game_version: 'V17',
    song_length: 120,
    video_url: null,
    preview_url: 'blog_prev.jpg',
    sound_preview_url: 'blog_sound.mp3',
    is_metadata_only: false,
    parent_chart_id: null,
    metadata: {},
    // download_url will be set per test case
  };

  const renderBlogItem = (itemProps = {}) => {
    const item = { ...baseBlogItem, ...itemProps };
    return render(ChartListItem, {
      props: {
        item,
        isBlog: true,
        // No admin-specific props needed
        getPreviewUrl: mockGetPreviewUrl,
        getSoundPreviewUrl: mockGetSoundPreviewUrl,
        // togglePublishChart and onFileDelete are not used in blog mode
      },
    });
  };

  beforeEach(() => {
    mockGetPreviewUrl.mockClear();
    mockGetSoundPreviewUrl.mockClear();
  });

  it('should not display ellipsis menu', () => {
    renderBlogItem();
    // Use queryByRole for elements that might not exist
    const ellipsisButton = screen.queryByRole('button', { name: /ellipses-vertical/i });
    expect(ellipsisButton).toBeNull();
  });

  it('should display download link when download_url is present', () => {
    const downloadUrl = 'http://example.com/download.zip';
    renderBlogItem({ download_url: downloadUrl });

    const downloadLink = screen.getByText('blog.download');
    expect(downloadLink).toBeInTheDocument();
    expect(downloadLink.closest('a')).toHaveAttribute('href', downloadUrl);
    expect(downloadLink.closest('a')).toHaveAttribute('target', '_blank');
    expect(downloadLink.closest('a')).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it("should display 'Download not available' when download_url is absent", () => {
    renderBlogItem({ download_url: null });

    expect(screen.getByText('blog.download_not_available')).toBeInTheDocument();
    expect(screen.queryByText('blog.download')).toBeNull();
  });
});
