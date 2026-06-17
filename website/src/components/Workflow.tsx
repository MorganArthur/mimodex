import { useScrollReveal } from "@/hooks/useScrollReveal";
import { FolderOpen, MessageSquare, Search, Lightbulb, Shield, GitCompare, GitCommit } from "lucide-react";

const steps = [
  { icon: FolderOpen, title: "选择本地项目", desc: "选择或打开本地项目作为工作区" },
  { icon: MessageSquare, title: "创建对话线程", desc: "开启与 Agent 的对话，明确目标与需求" },
  { icon: Search, title: "理解项目上下文", desc: "Agent 读取项目结构，理解代码与依赖关系" },
  { icon: Lightbulb, title: "生成修改方案", desc: "Agent 基于需求生成可执行的修改方案" },
  { icon: Shield, title: "审批写入/命令执行", desc: "你审批后，Agent 写入文件或执行终端命令" },
  { icon: GitCompare, title: "Diff 审阅", desc: "查看变更差异，确认修改内容" },
  { icon: GitCommit, title: "Git 提交", desc: "提交到本地仓库，完成闭环" },
];

export default function Workflow() {
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
            Mimodex 工作流
          </h2>
          <p className="text-dark-400 text-lg max-w-xl mx-auto">
            从本地项目到代码变更审阅的完整闭环
          </p>
        </div>

        {/* Workflow image */}
        <div
          className={`mb-16 transition-all duration-700 delay-200 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <div className="rounded-2xl overflow-hidden border border-dark-800 bg-dark-900/30">
            <img
              src="./images/工作流程图.png"
              alt="Mimodex 工作流程"
              className="w-full h-auto"
              loading="lazy"
            />
          </div>
        </div>


      </div>
    </section>
  );
}
