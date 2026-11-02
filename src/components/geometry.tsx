import { createContext, useContext } from 'react';
import type { Selection } from '../collaboration/types';

export type Rect = { x: number; y: number; width: number; height: number };
export type Geometry = { caret: Rect; selection: Rect[]; width: number; height: number };
export type Layout = { textVersion: number; measure(range: Selection): Geometry | null };
export const GeometryContext = createContext<Layout>({ textVersion: -1, measure: () => null });
export const useGeometry = () => useContext(GeometryContext);
