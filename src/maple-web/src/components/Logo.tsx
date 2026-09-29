/** The Maple Notes mark: an original sugar-maple leaf on a deep maple-red tile (same artwork as the favicon). */
export function Logo({ className = "size-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#8f1d21" />
      <path
        d="M16 3.2L16.9 5L18 4.3L18.2 6.2L19.9 5.9L19 8.6Q18.9 11.6 21.3 10.6L21.7 8.4L22.6 9.3L24 7.2L24.6 8.6L27.9 7.4L26.3 10.6L27.2 12.2L24.6 13.4Q23.1 15.2 24.6 16.4L26.3 19L22.6 18.7Q18.8 18.5 16.7 20.4L15.3 20.4Q13.2 18.5 9.4 18.7L5.7 19L7.4 16.4Q8.9 15.2 7.4 13.4L4.8 12.2L5.7 10.6L4.1 7.4L7.4 8.6L8 7.2L9.4 9.3L10.3 8.4L10.7 10.6Q13.1 11.6 13 8.6L12.1 5.9L13.8 6.2L14 4.3L15.1 5Z"
        fill="#fff"
        stroke="#fff"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M16 19.8Q16.3 24.6 17.6 28.2" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
