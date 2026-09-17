// Shared UI kit (contract §15.11). Import from 'design/components' only, never from the files directly.
export { Button, type ButtonProps, type ButtonVariant, type ControlSize } from './Button';
export { IconButton, type IconButtonProps } from './IconButton';
export { Tile, type TileProps, type TileTone } from './Tile';
export { BottomSheet, type BottomSheetProps } from './BottomSheet';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
export { ToastProvider, useToast, type ToastApi, type ToastOptions, type ToastProviderProps, type ToastTone } from './Toast';
export { ProgressBar, progressPercent, type ProgressBarProps } from './ProgressBar';
export { Toggle, type ToggleProps } from './Toggle';
export { Slider, type SliderProps } from './Slider';
export { Segmented, type SegmentedOption, type SegmentedProps } from './Segmented';
export { PinPad, type PinPadProps } from './PinPad';
export { PageHeader, type PageHeaderProps } from './PageHeader';
export { Spinner, type SpinnerProps } from './Spinner';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { OfflineBadge, type OfflineBadgeProps } from './OfflineBadge';
export {
  Field,
  Select,
  TextArea,
  TextInput,
  type FieldProps,
  type SelectOption,
  type SelectProps,
  type TextAreaProps,
  type TextInputProps,
} from './Field';
export {
  AlertIcon,
  ArrowLeftIcon,
  BackspaceIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  CloudOffIcon,
  InfoIcon,
  MinusIcon,
  PlusIcon,
  type IconProps,
} from './internal/icons';
