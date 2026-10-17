import FeatureLab from "@/components/feature-lab/FeatureLab";
import { KeysProvider } from "@/components/bench/keys";
export default function FeaturesPage() {
  return (
    <KeysProvider>
      <FeatureLab />
    </KeysProvider>
  );
}
