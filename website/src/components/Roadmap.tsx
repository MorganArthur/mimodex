import { useScrollReveal } from "@/hooks/useScrollReveal";
import { Check, Clock, Rocket } from "lucide-react";

const phases = [
  {
    label: "Now",
    icon: Check,
    color: "bg-brand-400",
    textColor: "text-brand-400",
    borderColor: "border-brand-400/30",
    bgColor: "bg-brand-400/5",
    models: [
      { name: "MiMo v2.5", status: "available" },
      { name: "MiMo v2.5 Pro", status: "available" },
    ],
  },
  {
    label: "Next",
    icon: Clock,
    color: "bg-blue-400",
    textColor: "text-blue-400",
    borderColor: "border-blue-400/30",
    bgColor: "bg-blue-400/5",
    models: [
      { name: "Qwen", status: "planned" },
      { name: "DeepSeek", status: "planned" },
      { name: "OpenAI Compatible", status: "planned" },
    ],
  },
  {
    label: "Future",
    icon: Rocket,
    color: "bg-purple-400",
    textColor: "text-purple-400",
    borderColor: "border-purple-400/30",
    bgColor: "bg-purple-400/5",
    models: [
      { name: "Local Models", status: "planned" },
      { name: "Plugin Providers", status: "planned" },
      { name: "Multi-Agent", status: "planned" },
    ],
  },
];

export default function Roadmap() {
  const { ref, isVisible } = useScrollReveal<HTMLElement>();

  return (
    <section ref={ref} className="relative py-24 sm:py-32 bg-dark-950">
      <div className="container mx-auto px-4">
        {/* Section header */}
        <div
          className={`text-center mb-16 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            模型支持路线图
          </h2>
          <p className="text-dark-400 text-lg max-w-xl mx-auto">
            先兼容 MiMo，后续持续扩展
          </p>
        </div>

        {/* Roadmap image */}
        <div
          className={`mb-16 transition-all duration-700 delay-200 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <div className="rounded-2xl overflow-hidden border border-dark-800 bg-dark-900/30">
            <img
              src="./images/模型路线图.png"
              alt="Mimodex 模型支持路线图"
              className="w-full h-auto"
              loading="lazy"
            />
          </div>
        </div>


      </div>
    </section>
  );
}
