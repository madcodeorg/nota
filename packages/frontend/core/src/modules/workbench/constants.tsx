import type { ReactNode } from 'react';
import {
  RiArchiveStackFill,
  RiAttachment2,
  RiCalendarTodoFill,
  RiDeleteBin6Fill,
  RiFileList3Fill,
  RiFilePdf2Fill,
  RiFileTextFill,
  RiPencilFill,
  RiPriceTag3Fill,
  RiShapesFill,
  RiSparkling2Fill,
  RiVoiceprintFill,
} from 'react-icons/ri';

export const iconNameToIcon = {
  allDocs: <RiFileList3Fill size={19} />,
  collection: <RiArchiveStackFill size={19} />,
  doc: <RiFileTextFill size={19} />,
  page: <RiPencilFill size={19} />,
  edgeless: <RiShapesFill size={19} />,
  journal: <RiCalendarTodoFill size={19} />,
  tag: <RiPriceTag3Fill size={19} />,
  trash: <RiDeleteBin6Fill size={19} />,
  attachment: <RiAttachment2 size={19} />,
  pdf: <RiFilePdf2Fill size={19} />,
  ai: <RiSparkling2Fill size={19} />,
  meetings: <RiVoiceprintFill size={19} />,
} satisfies Record<string, ReactNode>;

export type ViewIconName = keyof typeof iconNameToIcon;
