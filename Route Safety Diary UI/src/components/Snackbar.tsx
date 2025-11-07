interface SnackbarProps {
  message: string;
}

export function Snackbar({ message }: SnackbarProps) {
  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="bg-neutral-900 text-white px-4 py-2.5 rounded shadow-lg">
        <p className="text-sm">{message}</p>
      </div>
    </div>
  );
}
