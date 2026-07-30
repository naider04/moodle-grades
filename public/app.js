document.addEventListener('DOMContentLoaded', function() {
    const modeButtons = document.querySelectorAll('.mode-btn');
    const loginForm = document.querySelector('.login-form');
    const gradesContainer = document.querySelector('.grades-container');
    const loginBtn = document.getElementById('login-btn');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const careerName = document.getElementById('career-name');
    const studentName = document.getElementById('student-name');
    const gradesTable = document.querySelector('.grades-table');
    
    let selectedMode = '';
    
    modeButtons.forEach(button => {
        button.addEventListener('click', function() {
            selectedMode = this.getAttribute('data-mode');
            document.querySelector('.mode-selection').style.display = 'none';
            loginForm.style.display = 'flex';
        });
    });
    
    loginBtn.addEventListener('click', function() {
        const username = usernameInput.value;
        const password = passwordInput.value;
        
        // Simulate login and fetch grades
        loginForm.style.display = 'none';
        gradesContainer.style.display = 'block';
        
        // Set student and career info
        studentName.textContent = `Wilmer Sandro Patiño Cuastuza`;
        careerName.textContent = selectedMode === 'presencial' ? 'TECNOLOGIAS DE LA INFORMACION' : 'IDIOMAS';
        
        // Simulate grades data
        const gradesData = [
            {
                subject: 'METHODS & STRATEGIES TO TEACH EFL TO CHILDREN',
                teacher: 'FERNANDO PATRICIO RIERA HERMIDA',
                finalGrade: '94.0',
                attendance: '100%',
                status: 'APROBADO',
                details: {
                    N1: '10.00',
                    N2: '9.33',
                    EXP1: '15.00',
                    P1: '34.33',
                    N3: '10.00',
                    N4: '9.33',
                    EXP2: '14.00',
                    EXT: '26.00',
                    P2: '33.33',
                    RE: '0',
                    PA: '0'
                }
            },
            {
                subject: 'LANGUAGE DEVELOPMENT: READING & WRITING COMPETENCES ENGLISH VI',
                teacher: 'EDWIN ALEXANDER PACHECO VASQUEZ',
                finalGrade: '57.0',
                attendance: '63%',
                status: 'REPROBADO',
                details: {
                    N1: '5.00',
                    N2: '5.50',
                    EXP1: '15.00',
                    P1: '25.50',
                    N3: '10.00',
                    N4: '1.00',
                    EXP2: '14.00',
                    EXT: '14.00',
                    P2: '25.00',
                    RE: '49',
                    PA: '0'
                }
            }
        ];
        
        // Render grades table
        renderGradesTable(gradesData);
    });
    
    function renderGradesTable(gradesData) {
        let tableHTML = '<table><tr><th>ASIGNATURA</th><th>DOCENTE</th><th>NOTA FINAL</th><th>ASIST.</th><th>ESTADO</th></tr>';
        
        gradesData.forEach(grade => {
            tableHTML += `<tr class="expandable">`;
            tableHTML += `<td>${grade.subject}</td>`;
            tableHTML += `<td>${grade.teacher}</td>`;
            tableHTML += `<td>${grade.finalGrade}</td>`;
            tableHTML += `<td>${grade.attendance}</td>`;
            tableHTML += `<td>${grade.status}</td>`;
            tableHTML += `</tr>`;
            
            // Expanded content
            tableHTML += `<tr class="expanded-content">`;
            tableHTML += `<td colspan="5">`;
            tableHTML += `<div class="details">`;
            tableHTML += `<p><strong>N1:</strong> ${grade.details.N1}</p>`;
            tableHTML += `<p><strong>N2:</strong> ${grade.details.N2}</p>`;
            tableHTML += `<p><strong>EXP1:</strong> ${grade.details.EXP1}</p>`;
            tableHTML += `<p><strong>P1:</strong> ${grade.details.P1}</p>`;
            tableHTML += `<p><strong>N3:</strong> ${grade.details.N3}</p>`;
            tableHTML += `<p><strong>N4:</strong> ${grade.details.N4}</p>`;
            tableHTML += `<p><strong>EXP2:</strong> ${grade.details.EXP2}</p>`;
            tableHTML += `<p><strong>EXT:</strong> ${grade.details.EXT}</p>`;
            tableHTML += `<p><strong>P2:</strong> ${grade.details.P2}</p>`;
            tableHTML += `<p><strong>RE:</strong> ${grade.details.RE}</p>`;
            tableHTML += `<p><strong>PA:</strong> ${grade.details.PA}</p>`;
            tableHTML += `</div>`;
            tableHTML += `</td>`;
            tableHTML += `</tr>`;
        });
        
        tableHTML += '</table>';
        gradesTable.innerHTML = tableHTML;
        
        // Add event listeners for expandable rows
        document.querySelectorAll('.expandable').forEach(row => {
            row.addEventListener('click', function() {
                const expandedContent = this.nextElementSibling;
                if (expandedContent.style.display === 'table-row') {
                    expandedContent.style.display = 'none';
                } else {
                    expandedContent.style.display = 'table-row';
                }
            });
        });
    }
});