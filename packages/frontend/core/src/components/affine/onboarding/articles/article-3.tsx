import type { OnboardingBlockOption } from '../types';

export const article3: Array<OnboardingBlockOption> = [
  {
    children: <h1>Plan on a whiteboard</h1>,
    offset: { x: -400, y: 0 },
  },
  {
    bg: '#DFF4E8',
    children: (
      <>
        <h2>Lay out the pieces</h2>
        <p>
          Switch from Page to Edgeless to arrange ideas across a canvas. Use
          separate notes for goals, options, and questions.
        </p>
      </>
    ),
    offset: { x: -400, y: 50 },
  },
  {
    bg: '#E1EFFF',
    children: (
      <>
        <h2>Compare two options</h2>
        <p>
          In this example, place a small raised bed beside a set of containers.
          List the space, watering, and supplies each option would need.
        </p>
      </>
    ),
    offset: { x: 430, y: -160 },
  },
  {
    bg: '#F3F0FF',
    children: (
      <>
        <h2>Choose a next action</h2>
        <p>
          Move the preferred option near the project goal. Add a note about the
          first step, such as measuring the available space.
        </p>
      </>
    ),
    offset: { x: -360, y: 0 },
  },
  {
    bg: '#FFEACA',
    children: <p>Goal: a small garden. Next step: measure the space.</p>,
    edgelessOnly: true,
    position: { x: 500, y: 500 },
    fromPosition: { x: 1000, y: -200 },
    enterDelay: 200,
    style: { width: 350 },
  },
];
