#!/usr/bin/env node
import { validateLastBellReviewFrame } from './review-frame.mjs';

const paths = process.argv.slice(2);
if (paths.length === 0) throw new Error('usage: validate-review-frame.mjs <review.png> [...review.png]');

const frames = [];
for (const path of paths) frames.push({ path, ...(await validateLastBellReviewFrame(path)) });
console.log(JSON.stringify({ validation: 'pass', frames }, null, 2));
