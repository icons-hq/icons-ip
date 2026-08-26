import sharp from 'sharp';

const MIN_MEAN_CHANNEL_STDEV = 5;

export function assertLastBellReviewFrameMetrics(metrics, label) {
  if (!Number.isFinite(metrics.mean_channel_stdev) || metrics.mean_channel_stdev < MIN_MEAN_CHANNEL_STDEV) {
    throw new Error(`${label}: review frame is visually empty or uniform (mean RGB stdev ${metrics.mean_channel_stdev})`);
  }
  if (!Number.isFinite(metrics.channel_range) || metrics.channel_range < 16) {
    throw new Error(`${label}: review frame has no usable tonal range (${metrics.channel_range})`);
  }
}

export async function lastBellReviewFrameMetrics(path) {
  const stats = await sharp(path).stats();
  const rgb = stats.channels.slice(0, 3);
  const mean_channel_stdev = rgb.reduce((sum, channel) => sum + channel.stdev, 0) / rgb.length;
  const channel_range = Math.max(...rgb.map((channel) => channel.max)) - Math.min(...rgb.map((channel) => channel.min));
  return {
    entropy: stats.entropy,
    mean_channel_stdev: Number(mean_channel_stdev.toFixed(3)),
    channel_range,
  };
}

export async function validateLastBellReviewFrame(path) {
  const metrics = await lastBellReviewFrameMetrics(path);
  assertLastBellReviewFrameMetrics(metrics, path);
  return metrics;
}
