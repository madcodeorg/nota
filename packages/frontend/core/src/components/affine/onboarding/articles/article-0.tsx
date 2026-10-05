import type { OnboardingBlockOption } from '../types';

export const article0: Array<OnboardingBlockOption> = [
  {
    children: <h1>Start with a note</h1>,
    offset: { x: -400, y: 0 },
  },
  {
    bg: '#DFF4E8',
    children: (
      <>
        <h2>Capture an idea</h2>
        <p>
          Create a note for a small project. Give it a title that will help you
          find it again, then write the question you want to answer.
        </p>
      </>
    ),
    offset: { x: -400, y: 50 },
  },
  {
    bg: '#E1EFFF',
    children: (
      <>
        <h2>Add a little structure</h2>
        <p>
          Use headings for the plan, decisions, and next steps. A short list is
          enough to begin; you can expand the note as the project grows.
        </p>
      </>
    ),
    offset: { x: 430, y: -160 },
  },
  {
    bg: '#F3F0FF',
    children: (
      <>
        <h2>Make the next step clear</h2>
        <p>
          For this example, the next step is to outline a weekend garden
          project. Write down what you need to learn before choosing plants.
        </p>
      </>
    ),
    offset: { x: -360, y: 0 },
  },
  {
    bg: '#FFEACA',
    children: <p>One note can hold the idea, the plan, and the next action.</p>,
    edgelessOnly: true,
    position: { x: 500, y: 500 },
    fromPosition: { x: 1000, y: -200 },
    enterDelay: 200,
    style: { width: 350 },
  },
];
