import { Course } from "./course";

export const ATTRIBUTE_PARENT = 'parent'
export const ATTRIBUTE_SHORTNAME = 'shortname'

export interface Category {
    id: string;
    slug: string;
    title: string;
    description: string;
    shortName?: string;
    caption?: string;
    children?: Category[];
    courses?: Course[];
}
