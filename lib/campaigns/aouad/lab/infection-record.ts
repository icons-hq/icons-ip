export type InfectionRecordStage = 'briefing' | 'hallway' | 'broadcast' | 'exit' | 'result';
export type InfectionRecordChoice = 'listen' | 'rush' | 'relay' | 'hide' | 'stairs' | 'window';
export type InfectionRecordResultType = 'escaped' | 'infected' | 'quarantined';

export type InfectionRecordState = {
  stage: InfectionRecordStage;
  exposure: number;
  choices: InfectionRecordChoice[];
  resultType: InfectionRecordResultType | null;
};

export const initialInfectionRecordState: InfectionRecordState = {
  stage: 'briefing',
  exposure: 0,
  choices: [],
  resultType: null,
};

export function advanceInfectionRecord(
  state: InfectionRecordState,
  choice: InfectionRecordChoice | 'start',
): InfectionRecordState {
  if (choice === 'start') return state.stage === 'briefing' ? { ...state, stage: 'hallway' } : state;
  if (state.stage === 'hallway' && (choice === 'listen' || choice === 'rush')) {
    return { ...state, stage: 'broadcast', exposure: state.exposure + (choice === 'rush' ? 1 : 0), choices: [...state.choices, choice] };
  }
  if (state.stage === 'broadcast' && (choice === 'relay' || choice === 'hide')) {
    return { ...state, stage: 'exit', exposure: state.exposure + (choice === 'relay' ? 1 : 0), choices: [...state.choices, choice] };
  }
  if (state.stage === 'exit' && (choice === 'stairs' || choice === 'window')) {
    const resultType: InfectionRecordResultType = choice === 'window'
      ? 'infected'
      : state.exposure >= 2
        ? 'infected'
        : state.exposure === 1
          ? 'quarantined'
          : 'escaped';
    return { ...state, stage: 'result', choices: [...state.choices, choice], resultType };
  }
  return state;
}
