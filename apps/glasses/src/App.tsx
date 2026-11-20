import React, { useEffect, useState } from 'react';
import { glassesManager } from './services/glassesManager';
import { GlassesState } from './types';
import { PhoneCompanion } from './components/PhoneCompanion';
import './styles.css';

export const App: React.FC = () => {
  const [state, setState] = useState<GlassesState>(glassesManager.getState());

  useEffect(() => {
    // Subscribe to glasses state updates
    const unsubscribe = glassesManager.subscribe((newState) => {
      setState(newState);
    });

    // Initialize glasses manager and SDK bridge
    glassesManager.init();

    return () => {
      unsubscribe();
    };
  }, []);

  return <PhoneCompanion state={state} />;
};

export default App;
