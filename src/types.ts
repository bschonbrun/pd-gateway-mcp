export interface Workflow {
  id: string;
  name: string;
  active: boolean;
  created_at: number;
  updated_at: number;
}

export interface WorkflowEvent {
  id: string;
  status: string;
  created_at: number;
}

export interface AppAction {
  key: string;
  name: string;
  description: string;
  component_type: string;
  configurable_props: ConfigurableProp[];
}

export interface ConfigurableProp {
  name: string;
  type: string;
  label?: string;
  description?: string;
  optional?: boolean;
}
