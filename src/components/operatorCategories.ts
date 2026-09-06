import {
  Calculator,
  Camera,
  Clock3,
  Focus,
  Layers2,
  MonitorUp,
  MousePointer2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { OperatorCategoryId } from '../graph';

export interface OperatorCategoryDefinition {
  id: OperatorCategoryId;
  label: string;
  summary: string;
  icon: LucideIcon;
}

export const OPERATOR_CATEGORIES = [
  {
    id: 'timing',
    label: 'Timing',
    summary: 'Clocks, phase, and repeating motion.',
    icon: Clock3,
  },
  {
    id: 'control',
    label: 'Control',
    summary: 'Values, math, mapping, and smoothing.',
    icon: Calculator,
  },
  {
    id: 'interaction-ai',
    label: 'Interaction & AI',
    summary: 'Pointer, hands-on controls, prompts, and model runtimes.',
    icon: MousePointer2,
  },
  {
    id: 'inputs',
    label: 'Inputs',
    summary: 'Camera, microphone, and local media files.',
    icon: Camera,
  },
  {
    id: 'generators',
    label: 'Generators',
    summary: 'Color and procedural frame sources.',
    icon: Sparkles,
  },
  {
    id: 'image-processing',
    label: 'Image Processing',
    summary: 'Transform, distort, filter, retain, and grade frames.',
    icon: Focus,
  },
  {
    id: 'compositing',
    label: 'Compositing',
    summary: 'Mask, layer, select, and blend frames.',
    icon: Layers2,
  },
  {
    id: 'output',
    label: 'Output',
    summary: 'Present frames and route audio to the browser tab.',
    icon: MonitorUp,
  },
] as const satisfies readonly OperatorCategoryDefinition[];
