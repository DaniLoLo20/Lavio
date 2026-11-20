import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn, STATUS, type Status } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
        outline: 'border bg-card hover:bg-muted',
        ghost: 'hover:bg-muted',
        destructive: 'bg-destructive text-white hover:opacity-90',
        success: 'bg-emerald-600 text-white hover:bg-emerald-700',
      },
      size: { default: 'h-10 px-4', sm: 'h-8 px-3 text-xs', lg: 'h-12 px-6 text-base', icon: 'h-9 w-9' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...p }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...p} />
));
Button.displayName = 'Button';

export const buttonClass = (variant: ButtonProps['variant'] = 'default', size: ButtonProps['size'] = 'default') =>
  buttonVariants({ variant, size });

const field = 'w-full rounded-md border bg-card px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(field, 'h-10', className)} {...p} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(field, 'min-h-[80px] py-2', className)} {...p} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn(field, 'h-10', className)} {...p} />
));
Select.displayName = 'Select';

export const Label = ({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn('mb-1 block text-xs font-medium text-muted-foreground', className)} {...p} />
);

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('rounded-lg border bg-card shadow-sm', className)} {...p} />
);
export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center justify-between gap-2 border-b px-4 py-3', className)} {...p} />
);
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('text-sm font-semibold', className)} {...p} />
);
export const CardContent = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-4', className)} {...p} />
);

export const Badge = ({ className, ...p }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', className)} {...p} />
);

export const StatusBadge = ({ status }: { status: Status }) => (
  <Badge className={STATUS[status].cls}>{STATUS[status].label}</Badge>
);

export const PageHeader = ({ title, children }: { title: string; children?: React.ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
    <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
    <div className="flex gap-2">{children}</div>
  </div>
);

export const ErrorText = ({ error }: { error?: unknown }) =>
  error ? <p className="text-sm text-destructive">{(error as Error).message}</p> : null;

export const Empty = ({ text }: { text: string }) => (
  <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>
);
