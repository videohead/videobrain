import type { Preview } from '@storybook/react-vite';
import '@xyflow/react/dist/style.css';
import '../src/styles.css';
import './preview.css';

const preview: Preview = {
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="vb-story-root" data-videobrain-ui="storybook">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'centered',
    a11y: {
      test: 'todo',
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
