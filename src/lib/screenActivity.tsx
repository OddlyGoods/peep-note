import { createContext, useContext } from 'react'

export const ScreenActivity = createContext(true)
export const useScreenActive = () => useContext(ScreenActivity)
