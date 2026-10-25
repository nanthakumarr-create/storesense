// Applications aligned by territory: #/territories lists territories, #/territories/TER-02 compares one territory's applicants.
import { useApp } from '../../state/AppState';
import { TerritoryList } from '../territories/TerritoryList';
import { TerritoryDetail } from '../territories/TerritoryDetail';

export function TerritoriesPage() {
  const { routeParam } = useApp();
  return routeParam ? <TerritoryDetail key={routeParam} id={routeParam} /> : <TerritoryList />;
}
