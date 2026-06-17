import Hero from "@/components/Hero";
import Features from "@/components/Features";
import Workflow from "@/components/Workflow";
import Roadmap from "@/components/Roadmap";
import Preview from "@/components/Preview";
import Download from "@/components/Download";
import Footer from "@/components/Footer";

export default function App() {
  return (
    <div className="min-h-screen bg-dark-950 text-dark-200">
      <Hero />
      <Features />
      <Workflow />
      <Roadmap />
      <Preview />
      <Download />
      <Footer />
    </div>
  );
}
