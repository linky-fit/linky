interface PickFilesOptions {
  accept: string;
  multiple?: boolean;
}

/** Opens the system file picker; resolves with the chosen files, or none when cancelled. */
export const pickFiles = ({
  accept,
  multiple = false,
}: PickFilesOptions): Promise<File[]> =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    // Attached and rendered off-screen: some mobile browsers ignore click() on detached or hidden inputs.
    Object.assign(input.style, {
      position: "fixed",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
    });
    const finish = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () =>
      finish(Array.from(input.files ?? [])),
    );
    input.addEventListener("cancel", () => finish([]));
    document.body.append(input);
    input.click();
  });

export const pickFile = async (accept: string): Promise<File | null> =>
  (await pickFiles({ accept }))[0] ?? null;

/** Lets a hook open the file picker of a mounted component. */
export interface FilePickerHandle {
  pick: () => void;
}
