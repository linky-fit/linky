import React from "react";

const readOnline = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine !== false;

/** Whether the browser reports a network connection, kept current. */
export const useOnline = (): boolean => {
  const [online, setOnline] = React.useState(readOnline);
  React.useEffect(() => {
    const update = () => setOnline(readOnline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
};
