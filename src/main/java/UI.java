import burp.api.montoya.MontoyaApi;
import burp.api.montoya.logging.Logging;
import org.fife.ui.rsyntaxtextarea.RSyntaxTextArea;
import org.fife.ui.rsyntaxtextarea.SyntaxConstants;
import org.fife.ui.rsyntaxtextarea.Theme;
import org.fife.ui.rtextarea.RTextScrollPane;
import org.json.JSONObject;

import javax.imageio.ImageIO;
import javax.swing.*;
import javax.swing.border.EmptyBorder;
import javax.swing.border.LineBorder;
import javax.swing.border.TitledBorder;
import java.awt.*;
import java.awt.event.FocusAdapter;
import java.awt.event.FocusEvent;
import java.awt.geom.Ellipse2D;
import java.awt.image.BufferedImage;
import java.io.*;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.*;
import java.util.List;

public class UI extends JTabbedPane {
    // Configuration
    private final File configFile = new File(System.getProperty("user.home") + File.separator + ".NeoJS", "tools.json");
    private final Map<String, String> toolCommands = new LinkedHashMap<>();
    private final JComboBox<String> toolSelector = new JComboBox<>();
    private static final JComboBox<String> domainSelector = new JComboBox<>();
    private final JTextArea outputArea = new JTextArea();
    private final Logging logging;
    private final MontoyaApi api;

    // Static settings
    public static boolean isExtensionEnabled = true;
    public static int numberOfWorkers = 4;
    public static boolean inScopeOnlyEnabled = true;
    public static String currentTheme;
    public static boolean isEndpointsEnabled = true;
    public static boolean isParamsEnabled = true;
    public static boolean isSourceMapsEnabled = true;

    public static DefaultListModel<String> endpointsModel;
    public static DefaultListModel<String> parametersModel;
    public static DefaultListModel<String> sourceMapsModel;

    public UI(MontoyaApi montoyaApi) {
        this.logging = montoyaApi.logging();
        this.api = montoyaApi;
        currentTheme = api.userInterface().currentTheme().name();
        initializeUI();
    }

    private void initializeUI() {
        ensureConfigDirectory();
        loadToolConfig();
        loadDomainFolders();

        setFont(new Font("Segoe UI", Font.PLAIN, 11));
        addTab(" Analysis ", createAnalysisTab());
        addTab(" Tools ", createToolsTab());
        addTab(" Extractor ", createExtractorTab());
        addTab(" Configuration ", createConfigurationTab());
        addTab(" About ", createAboutTab());
    }

    private JPanel createAnalysisTab() {
        JPanel panel = new JPanel(new BorderLayout(10, 10));
        panel.setBorder(BorderFactory.createEmptyBorder(10, 10, 10, 10)); // padding

        outputArea.setEditable(false);
        outputArea.setLineWrap(true);
        outputArea.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 12));

        JPanel topControls = new JPanel();
        topControls.setLayout(new BoxLayout(topControls, BoxLayout.X_AXIS));
        topControls.setBorder(BorderFactory.createEmptyBorder(0, 0, 10, 0)); // bottom padding

        JLabel domainLabel = new JLabel("🌐 Domain:");
        domainLabel.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 12));
        domainLabel.setPreferredSize(new Dimension(70, 30));
        domainLabel.setMaximumSize(new Dimension(70, 30));

        JLabel toolLabel = new JLabel("🔧 Tool:");
        toolLabel.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 12));
        toolLabel.setPreferredSize(new Dimension(50, 30));
        toolLabel.setMaximumSize(new Dimension(50, 30));

        Dimension comboSize = new Dimension(450, 30);
        domainSelector.setPreferredSize(comboSize);
        domainSelector.setMaximumSize(comboSize);

        toolSelector.setPreferredSize(comboSize);
        toolSelector.setMaximumSize(comboSize);

        Dimension buttonSize = new Dimension(170, 30);

        JButton runButton = new JButton(" ▶ Run ");
        runButton.setPreferredSize(buttonSize);
        runButton.setMaximumSize(buttonSize);
        runButton.setMinimumSize(buttonSize);

        JButton clearOutput = new JButton(" 🚮 Clear ");
        clearOutput.setPreferredSize(buttonSize);
        clearOutput.setMaximumSize(buttonSize);
        clearOutput.setMinimumSize(buttonSize);

        JButton deleteButton = new JButton(" ❌ Delete Domain");
        deleteButton.setPreferredSize(buttonSize);
        deleteButton.setMaximumSize(buttonSize);
        deleteButton.setMinimumSize(buttonSize);

        topControls.add(domainLabel);
        topControls.add(Box.createHorizontalStrut(15));
        topControls.add(domainSelector);
        topControls.add(Box.createHorizontalStrut(20));
        topControls.add(toolLabel);
        topControls.add(Box.createHorizontalStrut(5));
        topControls.add(toolSelector);
        topControls.add(Box.createHorizontalStrut(20));
        topControls.add(runButton);
        topControls.add(Box.createHorizontalStrut(10));
        topControls.add(clearOutput);
        topControls.add(Box.createHorizontalStrut(10));
        topControls.add(deleteButton);

        runButton.addActionListener(e -> {
            String selectedDomain = (String) domainSelector.getSelectedItem();
            String selectedTool = (String) toolSelector.getSelectedItem();

            if (selectedDomain == null || selectedDomain.isEmpty()) {
                JOptionPane.showMessageDialog(panel, "Please select a domain.", "No Domain Selected", JOptionPane.WARNING_MESSAGE);
                return;
            }

            if (selectedTool == null || selectedTool.isEmpty()) {
                JOptionPane.showMessageDialog(panel, "Please select a tool.", "No Tool Selected", JOptionPane.WARNING_MESSAGE);
                return;
            }

            // Disable button during execution
            runButton.setEnabled(false);
            runButton.setText("Running...");

            // Create and execute background worker
            new SwingWorker<Void, String>() {
                @Override
                protected Void doInBackground() throws Exception {
                    // This runs in background thread
                    executeToolOnDomain(selectedDomain, selectedTool);
                    return null;
                }

                @Override
                protected void process(List<String> chunks) {
                    // Update output area in EDT
                    for (String message : chunks) {
                        outputArea.append(message + "\n");
                    }
                }

                @Override
                protected void done() {
                    try {
                        get(); // Check for exceptions
                        outputArea.append("Execution completed successfully!\n");
                    } catch (Exception ex) {
                        outputArea.append("Error: " + ex.getMessage() + "\n");
                    } finally {
                        // Re-enable button in EDT
                        runButton.setEnabled(true);
                        runButton.setText(" ▶ Run ");
                    }
                }
            }.execute();
        });
        clearOutput.addActionListener(e -> {
            int confirm = JOptionPane.showConfirmDialog(panel,
                    "Are you sure you want to clear output box?",
                    "Confirm Deletion",
                    JOptionPane.YES_NO_OPTION,
                    JOptionPane.WARNING_MESSAGE);

            if (confirm == JOptionPane.YES_OPTION) {
                outputArea.setText("");
            }
        });
        deleteButton.addActionListener(e -> {
            String selectedDomain = (String) domainSelector.getSelectedItem();
            if (selectedDomain == null || selectedDomain.isEmpty()) {
                JOptionPane.showMessageDialog(panel, "Please select a domain to delete.", "No Domain Selected", JOptionPane.WARNING_MESSAGE);
                return;
            }

            int confirm = JOptionPane.showConfirmDialog(panel,
                    "Are you sure you want to delete all data for domain:\n" + selectedDomain + "?",
                    "Confirm Deletion",
                    JOptionPane.YES_NO_OPTION,
                    JOptionPane.WARNING_MESSAGE);

            if (confirm == JOptionPane.YES_OPTION) {
                File domainFolder = new File(Main.DEFAULT_BASE_PATH + File.separator + selectedDomain); // 🔧 Adjust this path
                if (domainFolder.exists() && domainFolder.isDirectory()) {
                    boolean success = Helper.deleteDirectoryRecursively(domainFolder);
                    if (success) {
                        JOptionPane.showMessageDialog(panel, "Domain folder deleted successfully.");
                        domainSelector.removeItem(selectedDomain); // Optional: update UI
                    } else {
                        JOptionPane.showMessageDialog(panel, "Failed to delete domain folder.", "Error", JOptionPane.ERROR_MESSAGE);
                    }
                } else {
                    JOptionPane.showMessageDialog(panel, "Domain folder not found.", "Not Found", JOptionPane.INFORMATION_MESSAGE);
                }
            }
        });

        panel.add(topControls, BorderLayout.NORTH);
        panel.add(new JScrollPane(outputArea), BorderLayout.CENTER);

        return panel;
    }

    private JPanel createToolsTab() {
        JPanel panel = new JPanel(new BorderLayout(10, 10));
        panel.setBorder(BorderFactory.createEmptyBorder(10, 10, 10, 10));

        // Add Command Panel
        JPanel addCommandPanel = new JPanel(new BorderLayout(5, 5));
        addCommandPanel.setBorder(BorderFactory.createTitledBorder("➕ Add Command"));

        JTextField nameField = new JTextField("Name");
        nameField.setPreferredSize(new Dimension(150, 28));
        setupPlaceholder(nameField, "Name");

        JTextField commandField = new JTextField("Your Command Template");
        commandField.setPreferredSize(new Dimension(500, 28));
        setupPlaceholder(commandField, "Your Command Template");

        JButton addCommandButton = new JButton("➕ Add");
        addCommandButton.setPreferredSize(new Dimension(80, 28));

        JPanel inputRow = new JPanel(new BorderLayout(5, 5));
        inputRow.add(nameField, BorderLayout.WEST);
        inputRow.add(commandField, BorderLayout.CENTER);
        inputRow.add(addCommandButton, BorderLayout.EAST);
        addCommandPanel.add(inputRow, BorderLayout.CENTER);

        // JSON Editor
        RSyntaxTextArea configEditor = new RSyntaxTextArea(20, 80);
        configEditor.setSyntaxEditingStyle(SyntaxConstants.SYNTAX_STYLE_JSON);
        configEditor.setCodeFoldingEnabled(true);
        try {
            if (currentTheme.equalsIgnoreCase("dark")){
                Theme.load(getClass().getResourceAsStream("/org/fife/ui/rsyntaxtextarea/themes/dark.xml"))
                        .apply(configEditor);
            } else {
                Theme.load(getClass().getResourceAsStream("/org/fife/ui/rsyntaxtextarea/themes/default.xml"))
                        .apply(configEditor);
            }
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        configEditor.setEditable(true);
        configEditor.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 13));
        configEditor.setText(readConfigAsPrettyJson());

        RTextScrollPane scrollPane = new RTextScrollPane(configEditor);

        if (api.userInterface().currentTheme().name().equals("DARK"))
        {
            configEditor.setBackground(new Color(0x2B2B2B));
            configEditor.setCaretColor(Color.WHITE);
            scrollPane.setBackground(new Color(0x2B2B2B));
        }

        // Clean Button
        JButton cleanButton = new JButton("❌ Delete File ");
        cleanButton.setPreferredSize(new Dimension(Short.MAX_VALUE, 36));
        cleanButton.addActionListener(e -> {
            int result = JOptionPane.showConfirmDialog(panel,
                    "Are you sure you want to clean the tools.json file?",
                    "Confirm Cleanup",
                    JOptionPane.YES_NO_OPTION);
            if (result == JOptionPane.YES_OPTION) {
                try {
                    String emptyJson = "// \"tools.json\" file stored at : {user_home}/.NeoJS/tools.json\n// You can use \"$path\" in your command to refer to the domain folder\n{\n}";
                    Files.writeString(configFile.toPath(), emptyJson);
                    configEditor.setText(emptyJson);
                    toolCommands.clear();
                    updateToolSelector();
                    JOptionPane.showMessageDialog(panel, "✅ Configuration cleaned.");
                } catch (Exception ex) {
                    logging.logToError(ex);
                    JOptionPane.showMessageDialog(panel, "❌ Failed to clean: " + ex.getMessage());
                }
            }
        });

        // Refresh Button
        JButton refreshButton = new JButton("🔃 Refresh ");
        refreshButton.setPreferredSize(new Dimension(Short.MAX_VALUE, 36));
        refreshButton.addActionListener(e -> {
            try {
                // Reload the content from the file
                String currentContent = Files.readString(configFile.toPath());
                configEditor.setText(currentContent);

                // Also reload the commands into memory
                toolCommands.clear();
                String stripped = currentContent.replaceAll("(?m)^//.*\\n?", "");
                JSONObject obj = new JSONObject(stripped);

                for (String key : obj.keySet()) {
                    JSONObject toolEntry = obj.getJSONObject(key);
                    toolCommands.put(key, toolEntry.getString("command"));
                }

                updateToolSelector();
                JOptionPane.showMessageDialog(panel, "✅ Configuration refreshed from file.");
            } catch (Exception ex) {
                logging.logToError(ex);
                JOptionPane.showMessageDialog(panel, "❌ Failed to refresh: " + ex.getMessage());
            }
        });

        // Create a panel for the bottom buttons
        JPanel buttonPanel = new JPanel(new GridLayout(1, 2, 5, 0));
        buttonPanel.add(cleanButton);
        buttonPanel.add(refreshButton);

        // Add button handler
        addCommandButton.addActionListener(e -> {
            String name = nameField.getText().trim();
            String command = commandField.getText().trim();

            if (name.isEmpty() || command.isEmpty() || name.equals("Name") || command.equals("Your Command Template")) {
                JOptionPane.showMessageDialog(panel, "⚠ Please enter both name and command.");
                return;
            }

            try {
                String current = configEditor.getText();
                String stripped = current.replaceAll("(?m)^//.*\\n?", "");
                JSONObject obj = new JSONObject(stripped);

                JSONObject toolEntry = new JSONObject();
                toolEntry.put("command", command);
                obj.put(name, toolEntry);

                toolCommands.put(name, command);
                updateToolSelector();

                String updated = "// \"tools.json\" file stored at : {user_home}/.NeoJS/tools.json\n// You can use \"$path\" in your command to refer to the domain folder\n" + obj.toString(4);
                configEditor.setText(updated);
                Files.writeString(configFile.toPath(), updated);

                nameField.setText("Name");
                commandField.setText("Your Command Template");
                JOptionPane.showMessageDialog(panel, "✅ Command added and saved.");
            } catch (Exception ex) {
                logging.logToError(ex);
                JOptionPane.showMessageDialog(panel, "❌ Failed to add command: " + ex.getMessage());
            }
        });

        // Layout
        JPanel topSection = new JPanel();
        topSection.setLayout(new BoxLayout(topSection, BoxLayout.Y_AXIS));
        topSection.add(addCommandPanel);
        topSection.add(Box.createVerticalStrut(10));

        panel.add(topSection, BorderLayout.NORTH);
        panel.add(scrollPane, BorderLayout.CENTER);
        panel.add(buttonPanel, BorderLayout.SOUTH);  // Changed from cleanButton to buttonPanel

        return panel;
    }

    private JPanel createExtractorTab() {
        // Initialize list models
        endpointsModel = new DefaultListModel<>();
        parametersModel = new DefaultListModel<>();
        sourceMapsModel = new DefaultListModel<>();

        // Main panel with padding
        JPanel mainPanel = new JPanel(new BorderLayout());
        mainPanel.setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));

        // Content panel with GridBagLayout for 3 horizontal sections
        JPanel contentPanel = new JPanel(new GridBagLayout());
        GridBagConstraints gbc = new GridBagConstraints();

        // Configure GridBagLayout for 3 equal horizontal sections
        gbc.fill = GridBagConstraints.BOTH;
        gbc.insets = new Insets(5, 5, 5, 5);
        gbc.weighty = 1.0; // Equal vertical distribution
        gbc.weightx = 1.0; // Full width
        gbc.gridx = 0;

        // Data for the three sections
        String[] labels = {" Endpoints  ", " Parameters ", " SourceMaps "};

        // Create the three horizontal sections
        gbc.gridy = 0;
        contentPanel.add(createExtractorSectionPanel(labels[0], endpointsModel), gbc);

        gbc.gridy = 1;
        contentPanel.add(createExtractorSectionPanel(labels[1], parametersModel), gbc);

        gbc.gridy = 2;
        contentPanel.add(createExtractorSectionPanel(labels[2], sourceMapsModel), gbc);

        mainPanel.add(contentPanel, BorderLayout.CENTER);
        return mainPanel;
    }

    private JPanel createExtractorSectionPanel(String title, DefaultListModel<String> listModel) {
        JPanel sectionPanel = new JPanel(new BorderLayout());
        sectionPanel.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createTitledBorder(
                        BorderFactory.createEtchedBorder(),
                        title,
                        javax.swing.border.TitledBorder.LEFT,
                        javax.swing.border.TitledBorder.TOP,
                        new Font("SansSerif", Font.BOLD, 12)
                ),
                BorderFactory.createEmptyBorder(8, 8, 8, 8) // Inner padding
        ));

        // Create JList with the provided model
        JList<String> jList = new JList<>(listModel);
        jList.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        jList.setFont(new Font("Monospace", Font.PLAIN, 11));

        // Add list to scroll pane
        JScrollPane scrollPane = new JScrollPane(jList);
        scrollPane.setVerticalScrollBarPolicy(JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED);
        scrollPane.setHorizontalScrollBarPolicy(JScrollPane.HORIZONTAL_SCROLLBAR_AS_NEEDED);

        // Button panel with padding
        JPanel buttonPanel = new JPanel(new FlowLayout(FlowLayout.LEFT, 5, 8));
        buttonPanel.setBorder(BorderFactory.createEmptyBorder(5, 0, 0, 0)); // Top margin for buttons

        // Copy button
        JButton copyButton = new JButton("Copy Selected");
        copyButton.setPreferredSize(new Dimension(120, 25));
        copyButton.addActionListener(e -> {
            String selected = jList.getSelectedValue();
            if (selected != null) {
                Helper.copyToClipboard(selected);
            }
        });

        // Copy All button
        JButton copyAllButton = new JButton("Copy All");
        copyAllButton.setPreferredSize(new Dimension(120, 25));
        copyAllButton.addActionListener(e -> {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < listModel.getSize(); i++) {
                sb.append(listModel.getElementAt(i));
                if (i < listModel.getSize() - 1) {
                    sb.append("\n");
                }
            }
            if (!sb.isEmpty()) {
                Helper.copyToClipboard(sb.toString());
            }
        });

        // Clear All button
        JButton clearAllButton = new JButton("Clear");
        clearAllButton.setPreferredSize(new Dimension(120, 25));
        clearAllButton.addActionListener(e -> {
            int result = JOptionPane.showConfirmDialog(
                    sectionPanel,
                    "Are you sure you want to clear all items?",
                    "Confirm Clear",
                    JOptionPane.YES_NO_OPTION
            );

            if (result == JOptionPane.YES_OPTION) {
                if (listModel == UI.endpointsModel) {
                    Helper.clearEndpoints();
                } else if (listModel == UI.parametersModel) {
                    Helper.clearParameters();
                } else if (listModel == UI.sourceMapsModel) {
                    Helper.clearSourceMaps();
                }
            }
        });

        buttonPanel.add(copyButton);
        buttonPanel.add(copyAllButton);
        buttonPanel.add(clearAllButton);

        // Add components to section panel
        sectionPanel.add(scrollPane, BorderLayout.CENTER);
        sectionPanel.add(buttonPanel, BorderLayout.SOUTH);

        return sectionPanel;
    }

    private Component createConfigurationTab() {
        JPanel panel = new JPanel(new GridBagLayout());
        panel.setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.insets = new Insets(10, 10, 10, 10);
        gbc.fill = GridBagConstraints.HORIZONTAL;
        gbc.gridx = 0;
        gbc.gridy = 0;
        gbc.gridwidth = 3;

        // Toggle Extension Button
        JToggleButton toggleExtension = new JToggleButton("Extension Enabled");
        Dimension toggleButtonSize = new Dimension(170, 40);
        toggleExtension.setSelected(true);
        toggleExtension.setPreferredSize(toggleButtonSize);
        toggleExtension.setMaximumSize(toggleButtonSize);
        toggleExtension.setMinimumSize(toggleButtonSize);
        toggleExtension.setBackground(Color.LIGHT_GRAY);
        toggleExtension.setFocusPainted(false);
        toggleExtension.setFont(new Font("Segoe UI", Font.BOLD, 12));

        toggleExtension.addActionListener(e -> {
            boolean enabled = toggleExtension.isSelected();
            toggleExtension.setText(enabled ? "Extension Enabled" : "Extension Disabled");
            toggleExtension.setBackground(enabled ? new Color(30, 144, 255) : Color.LIGHT_GRAY);
            toggleExtension.setForeground(enabled ? Color.WHITE : Color.BLACK);
            logging.logToOutput(enabled ? "[+] NeoJS enabled" : "[-] NeoJS disabled");
            isExtensionEnabled = enabled;
        });

        panel.add(toggleExtension, gbc);

        //  Options Panel: In-Scope Toggle + Base Path + Worker Spinner
        gbc.gridy++;
        gbc.gridwidth = 3;

        JPanel optionsPanel = new JPanel(new GridBagLayout());
        optionsPanel.setBorder(BorderFactory.createTitledBorder(
                BorderFactory.createEtchedBorder(), " Options ", TitledBorder.LEFT, TitledBorder.TOP,
                new Font("Segoe UI", Font.BOLD, 12)));
        optionsPanel.setBackground(panel.getBackground()); // match parent bg
        GridBagConstraints innerGbc = new GridBagConstraints();
        innerGbc.insets = new Insets(10, 10, 10, 10);
        innerGbc.fill = GridBagConstraints.HORIZONTAL;

        // In-Scope Toggle
        innerGbc.gridx = 0;
        innerGbc.gridy = 0;

        JLabel inScopeLabel = new JLabel("In-Scope Only");
        inScopeLabel.setFont(new Font("Segoe UI", Font.BOLD, 12));
        optionsPanel.add(inScopeLabel, innerGbc);

        innerGbc.gridx = 1;
        JToggleButton inScopeToggle = new JToggleButton("On");
        inScopeToggle.setSelected(true);
        inScopeToggle.setPreferredSize(new Dimension(60, 25));
        inScopeToggle.setFocusPainted(false);
        inScopeToggle.addActionListener(e -> {
            boolean selected = inScopeToggle.isSelected();
            inScopeToggle.setText(selected ? "ON" : "OFF");
            inScopeToggle.setBackground(selected ? new Color(60, 179, 113) : UIManager.getColor("Button.background"));
            inScopeToggle.setForeground(selected ? Color.WHITE : Color.BLACK);
            inScopeOnlyEnabled = selected;
        });
        optionsPanel.add(inScopeToggle, innerGbc);

        // Base Path Selector
        innerGbc.gridy++;
        innerGbc.gridx = 0;

        JLabel pathLabel = new JLabel("Base Path:");
        pathLabel.setFont(new Font("Segoe UI", Font.BOLD, 12));
        optionsPanel.add(pathLabel, innerGbc);

        innerGbc.gridx = 1;
        JTextField pathField = new JTextField(Main.DEFAULT_BASE_PATH.toFile().getAbsolutePath());
        pathField.setEditable(false);
        pathField.setFont(new Font("Segoe UI", Font.BOLD, 11));
        pathField.setPreferredSize(new Dimension(250, 25));
        optionsPanel.add(pathField, innerGbc);

        innerGbc.gridx = 2;
        JButton browseButton = new JButton("Browse...");
        browseButton.setPreferredSize(new Dimension(100, 25));
        browseButton.addActionListener(e -> {
            JFileChooser chooser = new JFileChooser(Main.DEFAULT_BASE_PATH.toFile());
            chooser.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
            if (chooser.showOpenDialog(panel) == JFileChooser.APPROVE_OPTION) {
                Main.DEFAULT_BASE_PATH = chooser.getSelectedFile().toPath();
                pathField.setText(Main.DEFAULT_BASE_PATH.toString());
                loadDomainFolders();
            }
        });
        optionsPanel.add(browseButton, innerGbc);

        // Worker Spinner
        innerGbc.gridx = 0;
        innerGbc.gridy++;
        JLabel workerLabel = new JLabel("Workers:");
        workerLabel.setFont(new Font("Segoe UI", Font.BOLD, 12));
        optionsPanel.add(workerLabel, innerGbc);

        innerGbc.gridx = 1;
        JSpinner workerSpinner = new JSpinner(new SpinnerNumberModel(4, 1, 32, 1));
        ((JSpinner.DefaultEditor) workerSpinner.getEditor()).getTextField().setColumns(3);
        workerSpinner.setPreferredSize(new Dimension(80, 25));
        optionsPanel.add(workerSpinner, innerGbc);

        // Add Options Panel to main panel
        panel.add(optionsPanel, gbc);

        // Extractor config
        innerGbc.gridx = 0;
        innerGbc.gridy++;
        innerGbc.gridwidth = 1;

        JLabel extractorLabel = new JLabel("Extractor Options:");
        extractorLabel.setFont(new Font("Segoe UI", Font.BOLD, 12));
        optionsPanel.add(extractorLabel, innerGbc);

        // Create horizontal panel for checkboxes
        JPanel checkboxPanel = new JPanel(new FlowLayout(FlowLayout.LEFT, 15, 0)); // 15px horizontal gap
        checkboxPanel.setBackground(panel.getBackground()); // match background

        JCheckBox endpointCheckBox = new JCheckBox("Endpoints", isEndpointsEnabled);
        JCheckBox paramsCheckBox = new JCheckBox("Parameters", isParamsEnabled);
        JCheckBox sourceMapsCheckBox = new JCheckBox("Source Maps", isSourceMapsEnabled);

        checkboxPanel.add(endpointCheckBox);
        checkboxPanel.add(paramsCheckBox);
        checkboxPanel.add(sourceMapsCheckBox);

        innerGbc.gridx = 1;
        innerGbc.gridwidth = 2;
        optionsPanel.add(checkboxPanel, innerGbc);

        endpointCheckBox.addActionListener(e -> isEndpointsEnabled = endpointCheckBox.isSelected());

        paramsCheckBox.addActionListener(e -> isParamsEnabled = paramsCheckBox.isSelected());

        sourceMapsCheckBox.addActionListener(e -> isSourceMapsEnabled = sourceMapsCheckBox.isSelected());

        // Apply Button
        JButton applyButton = new JButton(" Apply Settings ");
        applyButton.setPreferredSize(new Dimension(200, 36));
        applyButton.setFont(new Font("Segoe UI", Font.BOLD, 12));
        applyButton.addActionListener(e -> {
            int workerCount = (int) workerSpinner.getValue();
            numberOfWorkers = workerCount;
            logging.logToOutput("[*] Worker Count Set: " + workerCount);
            logging.logToOutput("[*] Base Folder: " + Main.DEFAULT_BASE_PATH.toString());
            JOptionPane.showMessageDialog(panel, "✅ Settings applied successfully.");
        });

        gbc.gridy++;
        gbc.gridx = 0;
        gbc.gridwidth = 3;
        gbc.anchor = GridBagConstraints.CENTER;
        panel.add(applyButton, gbc);

        return panel;
    }

    private Component createAboutTab() {
        int contentWidth = 800;
        int imageWidth = 310;

        JPanel panel = new JPanel(new GridBagLayout());
        panel.setBackground(currentTheme.equalsIgnoreCase("dark") ? getBackground() : new Color(248, 248, 248));
        panel.setBorder(new EmptyBorder(20, 20, 20, 20));

        JPanel contentPanel = new JPanel();
        contentPanel.setLayout(new BorderLayout(20, 0));
        contentPanel.setPreferredSize(new Dimension(contentWidth, 550));
        contentPanel.setBackground(currentTheme.equalsIgnoreCase("dark") ? getBackground().darker() : getBackground().brighter());
        contentPanel.setBorder(BorderFactory.createCompoundBorder(
                new LineBorder(currentTheme.equalsIgnoreCase("dark") ? getBackground().brighter() : getBackground().darker(), 1),
                new EmptyBorder(20, 20, 20, 20)
        ));

// ========== LEFT SIDE: Features ==========
        JPanel leftPanel = new JPanel();
        leftPanel.setLayout(new BoxLayout(leftPanel, BoxLayout.Y_AXIS));
        leftPanel.setPreferredSize(new Dimension(contentWidth, 550));
        leftPanel.setBackground(currentTheme.equalsIgnoreCase("dark") ? getBackground().darker() : getBackground().brighter());

        // Add title
        JLabel titleLabel = new JLabel(">>> Neo JS");
        titleLabel.setFont(new Font(Font.MONOSPACED, Font.BOLD, 36));
        titleLabel.setAlignmentX(Component.CENTER_ALIGNMENT);
        titleLabel.setBorder(new EmptyBorder(0, 0, 0, 0));
        leftPanel.add(titleLabel);

        String[] features = {
                "🕷️ JavaScript static analysis capabilities",
                "🕷️ Reconstruct HTTP requests from JavaScript code",
                "🕷️ Collect JavaScript from external files, HTML attributes, and inline scripts",
                "🕷️ Extract endpoints, parameters and source map files",
                "🕷️ Customizable command configurations",
                "🕷️ Domain-specific JavaScript analysis"
        };

        leftPanel.add(Box.createVerticalGlue());
        for (String feature : features) {
            JLabel label = new JLabel(feature);
            label.setFont(new Font(Font.MONOSPACED, Font.BOLD, 14));
            label.setBorder(new EmptyBorder(0, 0, 25, 0));
            leftPanel.add(label);
        }
        leftPanel.add(Box.createVerticalGlue());

// ========== RIGHT SIDE: Image ==========
        JPanel rightPanel = new JPanel();
        rightPanel.setPreferredSize(new Dimension(imageWidth, 550));
        rightPanel.setBackground(currentTheme.equalsIgnoreCase("dark") ? getBackground().darker() : getBackground().brighter());

        try {
            File imageFile = new File(Paths.get(Main.DEFAULT_BASE_PATH.getParent().toString(), "neo.png").toUri());
            BufferedImage originalImage = ImageIO.read(imageFile);

            int scaledW = (int)(originalImage.getWidth() * 0.65);
            int scaledH = (int)(originalImage.getHeight() * 0.65);

            Image scaled = originalImage.getScaledInstance(scaledW, scaledH, Image.SCALE_SMOOTH);

            BufferedImage ellipse = new BufferedImage(scaledW, scaledH, BufferedImage.TYPE_INT_ARGB);
            Graphics2D g2 = ellipse.createGraphics();
            g2.setClip(new Ellipse2D.Double(0, 0, scaledW, scaledH));
            g2.drawImage(scaled, 0, 0, null);
            g2.dispose();

            // Create a panel with elliptic border for the image
            JPanel imagePanel = new JPanel() {
                @Override
                protected void paintComponent(Graphics g) {
                    super.paintComponent(g);
                }

                @Override
                protected void paintChildren(Graphics g) {
                    super.paintChildren(g);
                    Graphics2D g2d = (Graphics2D) g;
                    g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                    g2d.setColor(currentTheme.equalsIgnoreCase("dark") ? getBackground().brighter() : getBackground().darker());
                    g2d.setStroke(new BasicStroke(3));
                    g2d.drawOval(15, 15, scaledW, scaledH);
                }
            };
            imagePanel.setPreferredSize(new Dimension(scaledW + 30, scaledH + 30));
            imagePanel.setBackground(currentTheme.equalsIgnoreCase("dark") ? getBackground().darker() : getBackground().brighter());
            imagePanel.setLayout(new FlowLayout(FlowLayout.CENTER, 15, 15));

            JLabel imgLabel = new JLabel(new ImageIcon(ellipse));
            imagePanel.add(imgLabel);
            rightPanel.add(imagePanel);

        } catch (Exception e) {
            rightPanel.add(new JLabel("Image not found"));
        }

// ========== Footer ==========
        JPanel footer = new JPanel(new FlowLayout(FlowLayout.CENTER));
        footer.setBackground(currentTheme.equalsIgnoreCase("dark") ? getBackground().darker() : getBackground().brighter());
        footer.setBorder(new EmptyBorder(10, 0, 0, 0));

        JLabel createdByLabel = new JLabel("Created by:");
        createdByLabel.setFont(new Font(Font.MONOSPACED, Font.BOLD, 14)); // Change font family, style, and size
        footer.add(createdByLabel);

        JButton githubButton = createLinkButton("B14CK-SPID3R", "https://github.com/B14CK-SPID3R");
        githubButton.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 14)); // Set font for first button
        footer.add(githubButton);
        footer.add(Box.createHorizontalStrut(100));
        JButton twitterButton = createLinkButton("@B14CK_SPID3R", "https://x.com/B14CK_SPID3R");
        twitterButton.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 14)); // Set font for second button
        footer.add(twitterButton);

// ========== Assemble ==========
        contentPanel.add(leftPanel, BorderLayout.WEST);
        contentPanel.add(rightPanel, BorderLayout.EAST);
        contentPanel.add(footer, BorderLayout.SOUTH);

        GridBagConstraints gbc = new GridBagConstraints();
        gbc.gridx = 0;
        gbc.gridy = 0;
        panel.add(contentPanel, gbc);

        return panel;
    }


    private void executeToolOnDomain(String domain, String tool) {
        try {
            File target = new File(Main.DEFAULT_BASE_PATH.toFile(), domain);
            String commandLine = toolCommands.get(tool).replace("$path", target.getAbsolutePath());

            publish("▶ Running: " + commandLine + "\n");

            String output = Helper.runCommandWithTarget(commandLine, target);

            for (String line : output.split("\\R")) {
                publish(line);
            }

            publish("\n✅ Command finished successfully");
        } catch (Exception ex) {
            logging.logToError(ex);
            publish("❌ Error: " + ex.getMessage());
        }
    }

    private void publish(String message) {
        // This method is used to send updates to the output area
        // It's typically called from the background thread during tool execution
        outputArea.append(message + "\n");

        // Optional: Auto-scroll to the bottom as new messages arrive
        outputArea.setCaretPosition(outputArea.getDocument().getLength());
    }

    private JButton createLinkButton(String text, String url) {
        JButton button = new JButton(text);
        button.setFont(new Font("Segoe UI", Font.PLAIN, 12));
        button.setForeground(new Color(0, 102, 204));
        button.setBorder(BorderFactory.createEmptyBorder(0, 0, 0, 0));
        button.setContentAreaFilled(false);
        button.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        button.addActionListener(e -> {
            try {
                Desktop.getDesktop().browse(new URI(url));
            } catch (Exception ex) {
                // Ignore browser errors
            }
        });
        return button;
    }

    private void ensureConfigDirectory() {
        File parent = configFile.getParentFile();
        if (!parent.exists() && !parent.mkdirs()) {
            logging.logToError("[-] Failed to create configuration directory: " + parent.getAbsolutePath());
        }

        if (!configFile.exists()) {
            try {
                JSONObject defaultConfig = new JSONObject();
                defaultConfig.put("Neo-JSRequests", new JSONObject().put("command", "node --no-warnings " + Paths.get(Main.DEFAULT_BASE_PATH.getParent().toString(), "plugins", "JSRequests", "jsrequests.js").toFile() + " $path --silent"));
                String jsonWithComment = "// \"tools.json\" file stored at : {user_home}/.NeoJS/tools.json\n// You can use \"$path\" in your command to refer to the domain folder\n"
                        + defaultConfig.toString(4);
                Files.writeString(configFile.toPath(), jsonWithComment);
            } catch (Exception e) {
                logging.logToError("[-] Failed to write default configuration: " + e.getMessage());
            }
        }
    }

    private void setupPlaceholder(JTextField textField, String placeholder) {
        textField.setForeground(Color.GRAY);
        textField.addFocusListener(new FocusAdapter() {
            public void focusGained(FocusEvent e) {
                if (textField.getText().equals(placeholder)) {
                    textField.setText("");
                    textField.setForeground(Color.BLACK);
                }
            }

            public void focusLost(FocusEvent e) {
                if (textField.getText().isEmpty()) {
                    textField.setForeground(Color.GRAY);
                    textField.setText(placeholder);
                }
            }
        });
    }

    private void loadToolConfig() {
        try {
            if (!configFile.exists()) return;
            String raw = Files.readString(configFile.toPath());
            String stripped = raw.replaceAll("(?m)^//.*\\n?", "");
            JSONObject obj = new JSONObject(stripped);
            toolCommands.clear();
            for (String key : obj.keySet()) {
                toolCommands.put(key, obj.getJSONObject(key).getString("command"));
            }
            updateToolSelector();
        } catch (Exception e) {
            logging.logToError(e);
        }
    }

    private void updateToolSelector() {
        toolSelector.removeAllItems();
        for (String name : toolCommands.keySet()) {
            toolSelector.addItem(name);
        }
    }

    public static void loadDomainFolders() {
        domainSelector.removeAllItems();
        File[] folders = Main.DEFAULT_BASE_PATH.toFile().listFiles(File::isDirectory);
        if (folders != null) {
            for (File f : folders) {
                domainSelector.addItem(f.getName());
            }
        }
    }

    private String readConfigAsPrettyJson() {
        try {
            if (!configFile.exists()) {
                return "// \"tools.json.json\" file stored at : {user_home}/.NeoJS/tools.json\n// You can use \"$path\" in your command to refer to the domain folder\n{\n}";
            }
            return Files.readString(configFile.toPath());
        } catch (Exception e) {
            logging.logToError(e);
            return "// Failed to load tools.json\n{\n}";
        }
    }

}
