export const hasClipboardImage = (data: DataTransfer | null) =>
  [...(data?.items ?? [])].some((item) => item.type.startsWith("image/"));
